import { Prisma } from '@prisma/client';
import type { DocListQuery, Role, StockActionInput } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { fromDbDate, toDbDate } from '../../lib/dates';
import { HttpError, conflict, notFound } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { post, reverse, type PostedTxn } from '../inventory/inventory.service';
import {
  assertBackdateAllowed,
  dec,
  defaultWarehouseId,
  explainShortage,
  resolveItems,
} from '../documents/common';

const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  item: { select: { code: true, name: true, unit: { select: { code: true } } } },
  createdBy: { select: { name: true } },
};
type Doc = Prisma.StockActionDocGetPayload<{ include: typeof include }>;

export function serialize(d: Doc) {
  const { txnDate, ...rest } = d;
  return { ...rest, txnDate: fromDbDate(txnDate) };
}

const snapshot = (d: Doc) => ({
  actionNo: d.actionNo,
  action: d.action,
  status: d.status,
  itemId: d.itemId,
  qty: d.qty.toString(),
  reason: d.reason,
});

async function lockDoc(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM stock_actions WHERE id = ${id}::uuid FOR UPDATE`;
  const d = await tx.stockActionDoc.findUnique({ where: { id }, include });
  if (!d) throw notFound('Stock action not found');
  return d;
}

const data = (input: StockActionInput, warehouseId: string) => ({
  action: input.action,
  txnDate: toDbDate(input.txnDate),
  warehouseId,
  itemId: input.itemId,
  qty: dec(input.qty),
  reason: input.reason,
  remarks: input.remarks ?? null,
});

export async function create(input: StockActionInput, userId: string, idempotencyKey?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const prior = await tx.stockActionDoc.findUnique({ where: { idempotencyKey }, include });
        if (prior) return prior;
      }
      await resolveItems(tx, [{ itemId: input.itemId }]);
      const doc = await tx.stockActionDoc.create({
        data: {
          ...data(input, await defaultWarehouseId(tx, input.warehouseId)),
          idempotencyKey,
          createdById: userId,
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'CREATE',
        entity: 'StockAction',
        entityId: doc.id,
        newValue: snapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    if (idempotencyKey) {
      const prior = await prisma.stockActionDoc.findUnique({ where: { idempotencyKey }, include });
      if (prior) return prior;
    }
    throw e;
  }
}

export async function update(id: string, input: StockActionInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const old = await lockDoc(tx, id);
    if (old.status !== 'DRAFT')
      throw conflict(`Only DRAFT stock actions can be edited (this one is ${old.status})`);
    await resolveItems(tx, [{ itemId: input.itemId }]);
    const doc = await tx.stockActionDoc.update({
      where: { id },
      data: data(input, await defaultWarehouseId(tx, input.warehouseId)),
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'StockAction',
      entityId: id,
      oldValue: snapshot(old),
      newValue: snapshot(doc),
    });
    return doc;
  });
}

/**
 * DAMAGE moves USABLE → DAMAGED (one DAMAGE txn). SCRAP removes DAMAGED stock (one SCRAP txn).
 * REPAIR moves DAMAGED → USABLE as an ADJUSTMENT_OUT/ADJUSTMENT_IN pair sharing a group id.
 * Each posting fails as a whole if the source bucket is short.
 */
export async function confirm(id: string, userId: string, role: Role) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CONFIRMED') return d;
    if (d.status === 'CANCELLED') throw conflict('A cancelled stock action cannot be confirmed');
    const date = fromDbDate(d.txnDate);
    assertBackdateAllowed(role, date);
    await resolveItems(tx, [{ itemId: d.itemId }]);

    const base = {
      txnDate: date,
      userId,
      referenceType: 'STOCK_ACTION',
      referenceId: d.id,
      referenceNo: d.actionNo,
      remarks: d.reason,
    };
    const line = (direction: 'IN' | 'OUT', stockStatus: 'USABLE' | 'DAMAGED') => ({
      itemId: d.itemId,
      warehouseId: d.warehouseId,
      direction,
      stockStatus,
      qty: d.qty.toString(),
    });
    let txn: PostedTxn;
    let pair: PostedTxn | undefined;
    try {
      if (d.action === 'DAMAGE') {
        txn = await post(
          {
            ...base,
            type: 'DAMAGE',
            idempotencyKey: `stock-action-confirm:${d.id}`,
            lines: [line('OUT', 'USABLE'), line('IN', 'DAMAGED')],
          },
          tx,
        );
      } else if (d.action === 'SCRAP') {
        txn = await post(
          {
            ...base,
            type: 'SCRAP',
            idempotencyKey: `stock-action-confirm:${d.id}`,
            lines: [line('OUT', 'DAMAGED')],
          },
          tx,
        );
      } else {
        txn = await post(
          {
            ...base,
            type: 'ADJUSTMENT_OUT',
            groupId: d.actionNo,
            idempotencyKey: `stock-action-confirm:${d.id}`,
            lines: [line('OUT', 'DAMAGED')],
          },
          tx,
        );
        pair = await post(
          {
            ...base,
            type: 'ADJUSTMENT_IN',
            groupId: d.actionNo,
            idempotencyKey: `stock-action-confirm-in:${d.id}`,
            lines: [line('IN', 'USABLE')],
          },
          tx,
        );
      }
    } catch (e) {
      return explainShortage(tx, e);
    }
    const doc = await tx.stockActionDoc.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        txnId: txn.id,
        pairTxnId: pair?.id,
        confirmedAt: new Date(),
        confirmedById: userId,
      },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CONFIRM',
      entity: 'StockAction',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CONFIRMED', action: d.action, reason: d.reason, txnNo: txn.txnNo },
    });
    return doc;
  });
}

/** Cancels a DRAFT, or a CONFIRMED action via reversal (refused if the moved stock was already used). */
export async function cancel(id: string, reason: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CANCELLED') throw conflict('Stock action is already cancelled');
    const reversals: string[] = [];
    if (d.status === 'CONFIRMED') {
      try {
        // Repair: undo the USABLE-in leg first so the goods are removed before the DAMAGED bucket regains them.
        for (const txnId of [d.pairTxnId, d.txnId]) {
          if (txnId)
            reversals.push(
              (await reverse(txnId, `${d.actionNo} cancelled: ${reason}`, userId, { tx })).txnNo,
            );
        }
      } catch (e) {
        try {
          await explainShortage(tx, e);
        } catch (x) {
          if (x instanceof HttpError && x.status === 409)
            throw conflict(`Cannot cancel ${d.actionNo}: ${x.message}`, x.details);
          throw x;
        }
      }
    }
    const doc = await tx.stockActionDoc.update({
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
      entity: 'StockAction',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CANCELLED', reason, reversals },
    });
    return doc;
  });
}

export async function get(id: string) {
  const d = await prisma.stockActionDoc.findUnique({ where: { id }, include });
  if (!d) throw notFound('Stock action not found');
  return d;
}

export async function list(q: DocListQuery) {
  const where: Prisma.StockActionDocWhereInput = {
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
            { actionNo: { contains: q.q, mode: 'insensitive' } },
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
    prisma.stockActionDoc.findMany({
      where,
      include,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.stockActionDoc.count({ where }),
  ]);
  return { data: rows.map(serialize), page: q.page, pageSize: q.pageSize, total };
}
