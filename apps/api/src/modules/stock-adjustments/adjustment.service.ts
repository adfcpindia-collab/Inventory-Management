import { Prisma } from '@prisma/client';
import type { DocListQuery, Role, StockAdjustmentInput, StockStatus } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { fromDbDate, toDbDate } from '../../lib/dates';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { post, reverse } from '../inventory/inventory.service';
import { assertBackdateAllowed, dec, defaultWarehouseId, resolveItems } from '../documents/common';

const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  item: { select: { code: true, name: true, unit: { select: { code: true } } } },
  createdBy: { select: { name: true } },
};
type Doc = Prisma.StockAdjustmentGetPayload<{ include: typeof include }>;

export function serialize(d: Doc) {
  const { txnDate, ...rest } = d;
  return { ...rest, txnDate: fromDbDate(txnDate) };
}

const snapshot = (d: Doc) => ({
  adjustmentNo: d.adjustmentNo,
  status: d.status,
  approvalStatus: d.approvalStatus,
  itemId: d.itemId,
  stockStatus: d.stockStatus,
  systemQty: d.systemQty.toString(),
  physicalQty: d.physicalQty.toString(),
  difference: d.difference.toString(),
  reason: d.reason,
});

async function lockDoc(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id}::uuid FOR UPDATE`;
  const d = await tx.stockAdjustment.findUnique({ where: { id }, include });
  if (!d) throw notFound('Stock adjustment not found');
  return d;
}

/** Current cached balance of one bucket (0 if it has never moved). */
async function balance(
  tx: Tx,
  itemId: string,
  warehouseId: string,
  status: StockStatus,
  lock = false,
) {
  if (lock) {
    // Same lock InventoryService.post takes, so the balance cannot change before we post.
    await tx.$executeRaw`
      INSERT INTO stock_balances (item_id, warehouse_id, stock_status, qty, updated_at)
      VALUES (${itemId}::uuid, ${warehouseId}::uuid, ${status}::"StockStatus", 0, now())
      ON CONFLICT DO NOTHING`;
  }
  const rows = lock
    ? await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT qty FROM stock_balances WHERE item_id = ${itemId}::uuid
          AND warehouse_id = ${warehouseId}::uuid AND stock_status = ${status}::"StockStatus" FOR UPDATE`
    : await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT qty FROM stock_balances WHERE item_id = ${itemId}::uuid
          AND warehouse_id = ${warehouseId}::uuid AND stock_status = ${status}::"StockStatus"`;
  return dec(rows[0]?.qty ?? 0);
}

/** Snapshots the system quantity and derives the difference; a count that matches is rejected. */
async function build(tx: Tx, input: StockAdjustmentInput) {
  await resolveItems(tx, [{ itemId: input.itemId }]);
  const warehouseId = await defaultWarehouseId(tx, input.warehouseId);
  const systemQty = await balance(tx, input.itemId, warehouseId, input.stockStatus);
  const physicalQty = dec(input.physicalQty);
  const difference = physicalQty.minus(systemQty);
  if (difference.isZero())
    throw unprocessable(
      `Physical quantity equals the system quantity (${systemQty.toFixed(3)}); nothing to adjust`,
    );
  return {
    txnDate: toDbDate(input.txnDate),
    warehouseId,
    itemId: input.itemId,
    stockStatus: input.stockStatus,
    systemQty,
    physicalQty,
    difference,
    reason: input.reason,
    remarks: input.remarks ?? null,
  };
}

export async function create(input: StockAdjustmentInput, userId: string, idempotencyKey?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const prior = await tx.stockAdjustment.findUnique({ where: { idempotencyKey }, include });
        if (prior) return prior;
      }
      const doc = await tx.stockAdjustment.create({
        data: { ...(await build(tx, input)), idempotencyKey, createdById: userId },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'CREATE',
        entity: 'StockAdjustment',
        entityId: doc.id,
        newValue: snapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    if (idempotencyKey) {
      const prior = await prisma.stockAdjustment.findUnique({ where: { idempotencyKey }, include });
      if (prior) return prior;
    }
    throw e;
  }
}

/** Editing re-takes the snapshot and withdraws any pending approval request. */
export async function update(id: string, input: StockAdjustmentInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const old = await lockDoc(tx, id);
    if (old.status !== 'DRAFT')
      throw conflict(`Only DRAFT adjustments can be edited (this one is ${old.status})`);
    const doc = await tx.stockAdjustment.update({
      where: { id },
      data: {
        ...(await build(tx, input)),
        approvalStatus: 'NONE',
        approvedById: null,
        approvedAt: null,
      },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'StockAdjustment',
      entityId: id,
      oldValue: snapshot(old),
      newValue: snapshot(doc),
    });
    return doc;
  });
}

/**
 * Approval gate. A STORE user's confirm only requests approval (draft → approval PENDING, HTTP 202,
 * no stock effect). A MANAGER/ADMIN confirm is the approval: the balance is re-read under lock and, if
 * it still equals the snapshot, ADJUSTMENT_IN / ADJUSTMENT_OUT is posted in the same DB transaction.
 */
export async function confirm(id: string, userId: string, role: Role) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CONFIRMED') return d;
    if (d.status === 'CANCELLED') throw conflict('A cancelled adjustment cannot be confirmed');

    if (role !== 'ADMIN' && role !== 'MANAGER') {
      if (d.approvalStatus === 'PENDING') return d;
      const doc = await tx.stockAdjustment.update({
        where: { id },
        data: { approvalStatus: 'PENDING' },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'REQUEST_APPROVAL',
        entity: 'StockAdjustment',
        entityId: id,
        oldValue: { approvalStatus: d.approvalStatus },
        newValue: { approvalStatus: 'PENDING', difference: d.difference.toString() },
      });
      return doc;
    }

    const date = fromDbDate(d.txnDate);
    assertBackdateAllowed(role, date);
    const current = await balance(tx, d.itemId, d.warehouseId, d.stockStatus, true);
    if (!current.eq(d.systemQty))
      throw conflict(
        `Stock changed since this count was recorded (system was ${d.systemQty.toFixed(3)}, now ${current.toFixed(3)}). Cancel this adjustment and recount`,
        { snapshot: d.systemQty.toFixed(3), current: current.toFixed(3) },
      );

    const up = d.difference.gt(0);
    const txn = await post(
      {
        type: up ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        txnDate: date,
        userId,
        referenceType: 'STOCK_ADJUSTMENT',
        referenceId: d.id,
        referenceNo: d.adjustmentNo,
        remarks: d.reason,
        idempotencyKey: `stock-adjustment-confirm:${d.id}`,
        lines: [
          {
            itemId: d.itemId,
            warehouseId: d.warehouseId,
            direction: up ? 'IN' : 'OUT',
            stockStatus: d.stockStatus,
            qty: d.difference.abs().toString(),
          },
        ],
      },
      tx,
    );
    const doc = await tx.stockAdjustment.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        approvalStatus: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
        txnId: txn.id,
        confirmedAt: new Date(),
        confirmedById: userId,
      },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CONFIRM',
      entity: 'StockAdjustment',
      entityId: id,
      oldValue: { status: d.status, approvalStatus: d.approvalStatus },
      newValue: { status: 'CONFIRMED', approvalStatus: 'APPROVED', txnNo: txn.txnNo },
    });
    return doc;
  });
}

/** Cancelling a pending draft is how a manager rejects it. A confirmed adjustment is reversed. */
export async function cancel(id: string, reason: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CANCELLED') throw conflict('Stock adjustment is already cancelled');
    let reversalNo: string | undefined;
    if (d.status === 'CONFIRMED') {
      reversalNo = (
        await reverse(d.txnId!, `${d.adjustmentNo} cancelled: ${reason}`, userId, { tx })
      ).txnNo;
    }
    const doc = await tx.stockAdjustment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelledById: userId,
      },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CANCEL',
      entity: 'StockAdjustment',
      entityId: id,
      oldValue: { status: d.status, approvalStatus: d.approvalStatus },
      newValue: { status: 'CANCELLED', reason, reversalNo },
    });
    return doc;
  });
}

export async function get(id: string) {
  const d = await prisma.stockAdjustment.findUnique({ where: { id }, include });
  if (!d) throw notFound('Stock adjustment not found');
  return d;
}

export async function list(q: DocListQuery) {
  const where: Prisma.StockAdjustmentWhereInput = {
    ...(q.status !== 'all' ? { status: q.status } : {}),
    ...(q.from || q.to
      ? {
          txnDate: {
            ...(q.from ? { gte: toDbDate(q.from) } : {}),
            ...(q.to ? { lte: toDbDate(q.to) } : {}),
          },
        }
      : {}),
    ...(q.q
      ? {
          OR: [
            { adjustmentNo: { contains: q.q, mode: 'insensitive' } },
            { reason: { contains: q.q, mode: 'insensitive' } },
            {
              item: {
                OR: [
                  { code: { contains: q.q, mode: 'insensitive' } },
                  { name: { contains: q.q, mode: 'insensitive' } },
                ],
              },
            },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      include,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.stockAdjustment.count({ where }),
  ]);
  return { data: rows.map(serialize), page: q.page, pageSize: q.pageSize, total };
}
