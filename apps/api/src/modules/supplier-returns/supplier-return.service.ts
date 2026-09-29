import { Prisma } from '@prisma/client';
import { type SupplierReturnInput, type DocListQuery, type Role } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { fromDbDate, toDbDate } from '../../lib/dates';
import { HttpError, conflict, notFound, unprocessable } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { post, reverse } from '../inventory/inventory.service';
import {
  assertBackdateAllowed,
  assertWithinOriginal,
  dec,
  defaultWarehouseId,
  explainShortage,
  mapDuplicate,
  resolveItems,
} from '../documents/common';

const include = {
  supplier: { select: { id: true, companyName: true } },
  procurement: { select: { id: true, grnNo: true, txnDate: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { name: true } },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    include: { item: { select: { code: true, name: true } }, unit: { select: { code: true } } },
  },
};
type Doc = Prisma.SupplierReturnGetPayload<{ include: typeof include }>;

export function serialize(d: Doc) {
  const { txnDate, procurement, ...rest } = d;
  return {
    ...rest,
    txnDate: fromDbDate(txnDate),
    procurement: { ...procurement, txnDate: fromDbDate(procurement.txnDate) },
    totals: { qty: d.lines.reduce((a, l) => a.plus(l.qty), dec(0)).toString() },
  };
}

const snapshot = (d: Doc) => ({
  returnNo: d.returnNo,
  status: d.status,
  procurementId: d.procurementId,
  lines: d.lines.map((l) => ({
    itemId: l.itemId,
    qty: l.qty.toString(),
    stockStatus: l.stockStatus,
  })),
});

/** The original GRN must be CONFIRMED; its lines are what can be returned. */
async function loadProcurement(tx: Tx, id: string) {
  const d = await tx.procurement.findUnique({ where: { id }, include: { lines: true } });
  if (!d) throw unprocessable('Original GRN does not exist');
  if (d.status !== 'CONFIRMED')
    throw unprocessable(`Challan ${d.grnNo} is ${d.status}; only confirmed GRNs can be returned`);
  return d;
}

/** Validates lines against the GRN: right items, and total returned ≤ procuremented. */
async function validateAgainstChallan(
  tx: Tx,
  procurement: Awaited<ReturnType<typeof loadProcurement>>,
  lines: { itemId: string; qty: string | number | Prisma.Decimal }[],
  selfId?: string,
) {
  const prior = await tx.supplierReturnItem.findMany({
    where: { ret: { procurementId: procurement.id, status: 'CONFIRMED', id: { not: selfId } } },
    select: { itemId: true, qty: true },
  });
  await assertWithinOriginal(tx, {
    label: `GRN ${procurement.grnNo}`,
    original: procurement.lines,
    prior,
    mine: lines.map((l) => ({ itemId: l.itemId, qty: dec(l.qty) })),
  });
}

async function build(tx: Tx, input: SupplierReturnInput, selfId?: string) {
  const procurement = await loadProcurement(tx, input.procurementId);
  if (input.txnDate < fromDbDate(procurement.txnDate))
    throw unprocessable('Return date cannot be before the GRN date');
  const items = await resolveItems(tx, input.lines);
  await validateAgainstChallan(tx, procurement, input.lines, selfId);
  return {
    procurement,
    warehouseId: await defaultWarehouseId(tx, input.warehouseId ?? procurement.warehouseId),
    lines: input.lines.map((l, i) => ({
      lineNo: i + 1,
      itemId: l.itemId,
      unitId: items.get(l.itemId)!.unitId,
      qty: dec(l.qty),
      stockStatus: l.stockStatus,
      reason: l.reason ?? null,
    })),
  };
}

async function lockDoc(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM supplier_returns WHERE id = ${id}::uuid FOR UPDATE`;
  const d = await tx.supplierReturn.findUnique({ where: { id }, include });
  if (!d) throw notFound('Supplier return not found');
  return d;
}

export async function create(input: SupplierReturnInput, userId: string, idempotencyKey?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const prior = await tx.supplierReturn.findUnique({ where: { idempotencyKey }, include });
        if (prior) return prior;
      }
      const b = await build(tx, input);
      const doc = await tx.supplierReturn.create({
        data: {
          returnNo: input.returnNo,
          txnDate: toDbDate(input.txnDate),
          supplierId: b.procurement.supplierId,
          procurementId: b.procurement.id,
          warehouseId: b.warehouseId,
          remarks: input.remarks,
          idempotencyKey,
          createdById: userId,
          lines: { create: b.lines },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'CREATE',
        entity: 'SupplierReturn',
        entityId: doc.id,
        newValue: snapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    if (idempotencyKey) {
      const prior = await prisma.supplierReturn.findUnique({ where: { idempotencyKey }, include });
      if (prior) return prior;
    }
    return mapDuplicate(e, 'Return number', input.returnNo);
  }
}

export async function update(id: string, input: SupplierReturnInput, userId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const old = await lockDoc(tx, id);
      if (old.status !== 'DRAFT')
        throw conflict(`Only DRAFT returns can be edited (this one is ${old.status})`);
      const b = await build(tx, input, id);
      await tx.supplierReturnItem.deleteMany({ where: { returnId: id } });
      const doc = await tx.supplierReturn.update({
        where: { id },
        data: {
          returnNo: input.returnNo,
          txnDate: toDbDate(input.txnDate),
          supplierId: b.procurement.supplierId,
          procurementId: b.procurement.id,
          warehouseId: b.warehouseId,
          remarks: input.remarks ?? null,
          lines: { create: b.lines },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'UPDATE',
        entity: 'SupplierReturn',
        entityId: id,
        oldValue: snapshot(old),
        newValue: snapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    return mapDuplicate(e, 'Return number', input.returnNo);
  }
}

/**
 * DRAFT → CONFIRMED. Re-checks the over-return rule while the GRN row is locked, then posts one
 * SUPPLIER_RETURN transaction. GOOD lines enter USABLE stock; DAMAGED / NEEDS_INSPECTION lines go to
 * their own buckets and are never available for procurement until moved by a later action.
 */
export async function confirm(id: string, userId: string, role: Role) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CONFIRMED') return d;
    if (d.status === 'CANCELLED') throw conflict('A cancelled return cannot be confirmed');
    if (d.lines.length === 0) throw unprocessable('Add at least one item before confirming');
    const date = fromDbDate(d.txnDate);
    assertBackdateAllowed(role, date);

    // Serialises concurrent returns (and a GRN cancel) against the same GRN.
    await tx.$queryRaw`SELECT id FROM procurements WHERE id = ${d.procurementId}::uuid FOR UPDATE`;
    const procurement = await loadProcurement(tx, d.procurementId);
    await validateAgainstChallan(tx, procurement, d.lines, id);

    const txn = await post(
      {
        type: 'SUPPLIER_RETURN',
        txnDate: date,
        userId,
        supplierId: d.supplierId,
        referenceType: 'SUPPLIER_RETURN',
        referenceId: d.id,
        referenceNo: d.returnNo,
        remarks: d.remarks ?? undefined,
        idempotencyKey: `supplier-return-confirm:${d.id}`,
        lines: d.lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: d.warehouseId,
          direction: 'OUT' as const,
          stockStatus: l.stockStatus,
          qty: l.qty.toString(),
        })),
      },
      tx,
    );
    const doc = await tx.supplierReturn.update({
      where: { id },
      data: { status: 'CONFIRMED', txnId: txn.id, confirmedAt: new Date(), confirmedById: userId },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CONFIRM',
      entity: 'SupplierReturn',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CONFIRMED', txnNo: txn.txnNo },
    });
    return doc;
  });
}

/** Cancels a DRAFT, or a CONFIRMED return via reversal (refused if the returned stock was already used). */
export async function cancel(id: string, reason: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CANCELLED') throw conflict('Supplier return is already cancelled');
    let reversalNo: string | undefined;
    if (d.status === 'CONFIRMED') {
      try {
        reversalNo = (await reverse(d.txnId!, `${d.returnNo} cancelled: ${reason}`, userId, { tx }))
          .txnNo;
      } catch (e) {
        try {
          await explainShortage(tx, e);
        } catch (x) {
          if (x instanceof HttpError && x.status === 409)
            throw conflict(`Cannot cancel ${d.returnNo}: ${x.message}`, x.details);
          throw x;
        }
      }
    }
    const doc = await tx.supplierReturn.update({
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
      entity: 'SupplierReturn',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CANCELLED', reason, reversalNo },
    });
    return doc;
  });
}

export async function get(id: string) {
  const d = await prisma.supplierReturn.findUnique({ where: { id }, include });
  if (!d) throw notFound('Supplier return not found');
  return d;
}

export async function list(q: DocListQuery) {
  const where: Prisma.SupplierReturnWhereInput = {
    ...(q.status !== 'all' ? { status: q.status } : {}),
    ...(q.partyId ? { supplierId: q.partyId } : {}),
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
            { returnNo: { contains: q.q, mode: 'insensitive' } },
            { remarks: { contains: q.q, mode: 'insensitive' } },
            { procurement: { grnNo: { contains: q.q, mode: 'insensitive' } } },
            { supplier: { companyName: { contains: q.q, mode: 'insensitive' } } },
            {
              lines: {
                some: {
                  item: {
                    OR: [
                      { code: { contains: q.q, mode: 'insensitive' } },
                      { name: { contains: q.q, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.supplierReturn.findMany({
      where,
      include,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.supplierReturn.count({ where }),
  ]);
  return { data: rows.map(serialize), page: q.page, pageSize: q.pageSize, total };
}
