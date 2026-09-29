import { Prisma } from '@prisma/client';
import type { DocListQuery, ProcurementInput, Role } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { fromDbDate, toDbDate } from '../../lib/dates';
import { HttpError, conflict, notFound, unprocessable } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { post, reverse } from '../inventory/inventory.service';
import {
  assertBackdateAllowed,
  dec,
  defaultWarehouseId,
  explainShortage,
  mapDuplicate,
  resolveItems,
  round2,
} from '../documents/common';

const include = {
  supplier: { select: { id: true, companyName: true, gstin: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { name: true } },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    include: { item: { select: { code: true, name: true } }, unit: { select: { code: true } } },
  },
};
type Doc = Prisma.ProcurementGetPayload<{ include: typeof include }>;

export function serialize(d: Doc) {
  let taxable = dec(0);
  let total = dec(0);
  for (const l of d.lines) {
    taxable = taxable.plus(dec(l.qty).times(l.rate));
    total = total.plus(l.amount);
  }
  const { txnDate, ...rest } = d;
  return {
    ...rest,
    txnDate: fromDbDate(txnDate),
    totals: {
      taxable: round2(taxable).toFixed(2),
      gst: round2(total.minus(round2(taxable))).toFixed(2),
      total: round2(total).toFixed(2),
    },
  };
}

async function buildLines(tx: Tx, lines: ProcurementInput['lines']) {
  const items = await resolveItems(tx, lines);
  return lines.map((l, i) => {
    const item = items.get(l.itemId)!;
    const gst = dec(l.gstRate ?? item.gstRate);
    const amount = round2(
      dec(l.qty)
        .times(l.rate!)
        .times(dec(1).plus(gst.div(100))),
    );
    return {
      lineNo: i + 1,
      itemId: l.itemId,
      unitId: item.unitId,
      qty: dec(l.qty),
      rate: dec(l.rate!),
      gstRate: gst,
      amount,
      batchNo: l.batchNo ?? null,
    };
  });
}

async function assertSupplier(tx: Tx, id: string) {
  const s = await tx.supplier.findUnique({ where: { id } });
  if (!s) throw unprocessable('Supplier does not exist');
  if (!s.active) throw unprocessable(`Supplier ${s.companyName} is inactive`);
}

const notFoundDoc = () => notFound('Procurement not found');
const auditSnapshot = (d: Doc) => ({
  grnNo: d.grnNo,
  status: d.status,
  lines: d.lines.length,
  supplierId: d.supplierId,
});

export async function create(input: ProcurementInput, userId: string, idempotencyKey?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const prior = await tx.procurement.findUnique({ where: { idempotencyKey }, include });
        if (prior) return prior;
      }
      await assertSupplier(tx, input.supplierId);
      const lines = await buildLines(tx, input.lines);
      const doc = await tx.procurement.create({
        data: {
          grnNo: input.grnNo,
          txnDate: toDbDate(input.txnDate),
          supplierId: input.supplierId,
          warehouseId: await defaultWarehouseId(tx, input.warehouseId),
          remarks: input.remarks,
          idempotencyKey,
          createdById: userId,
          lines: { create: lines },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'CREATE',
        entity: 'Procurement',
        entityId: doc.id,
        newValue: auditSnapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    if (idempotencyKey) {
      const prior = await prisma.procurement.findUnique({ where: { idempotencyKey }, include });
      if (prior) return prior; // lost a race with an identical request
    }
    return mapDuplicate(e, 'GRN number', input.grnNo);
  }
}

export async function update(id: string, input: ProcurementInput, userId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const old = await lockDoc(tx, id);
      if (old.status !== 'DRAFT')
        throw conflict(`Only DRAFT procurements can be edited (this one is ${old.status})`);
      await assertSupplier(tx, input.supplierId);
      const lines = await buildLines(tx, input.lines);
      await tx.procurementItem.deleteMany({ where: { procurementId: id } });
      const doc = await tx.procurement.update({
        where: { id },
        data: {
          grnNo: input.grnNo,
          txnDate: toDbDate(input.txnDate),
          supplierId: input.supplierId,
          warehouseId: await defaultWarehouseId(tx, input.warehouseId),
          remarks: input.remarks ?? null,
          lines: { create: lines },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'UPDATE',
        entity: 'Procurement',
        entityId: id,
        oldValue: auditSnapshot(old),
        newValue: auditSnapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    return mapDuplicate(e, 'GRN number', input.grnNo);
  }
}

/** Row-locks the document so concurrent confirm/cancel/edit calls serialise. */
async function lockDoc(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM procurements WHERE id = ${id}::uuid FOR UPDATE`;
  const d = await tx.procurement.findUnique({ where: { id }, include });
  if (!d) throw notFoundDoc();
  return d;
}

/**
 * DRAFT → CONFIRMED: posts a PROCUREMENT transaction and flips the status in ONE DB transaction.
 * Repeating the call on an already-confirmed document returns it unchanged (safe double-submit).
 */
export async function confirm(id: string, userId: string, role: Role) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CONFIRMED') return d;
    if (d.status === 'CANCELLED') throw conflict('A cancelled procurement cannot be confirmed');
    if (d.lines.length === 0) throw unprocessable('Add at least one item before confirming');
    const date = fromDbDate(d.txnDate);
    assertBackdateAllowed(role, date);
    await assertSupplier(tx, d.supplierId);

    let txn;
    try {
      txn = await post(
        {
          type: 'PROCUREMENT',
          txnDate: date,
          userId,
          supplierId: d.supplierId,
          referenceType: 'PROCUREMENT',
          referenceId: d.id,
          referenceNo: d.grnNo,
          remarks: d.remarks ?? undefined,
          idempotencyKey: `procurement-confirm:${d.id}`,
          lines: d.lines.map((l) => ({
            itemId: l.itemId,
            warehouseId: d.warehouseId,
            direction: 'IN' as const,
            qty: l.qty.toString(),
            unitCost: l.rate.toString(),
            batchNo: l.batchNo,
          })),
        },
        tx,
      );
    } catch (e) {
      return explainShortage(tx, e);
    }
    const doc = await tx.procurement.update({
      where: { id },
      data: { status: 'CONFIRMED', txnId: txn.id, confirmedAt: new Date(), confirmedById: userId },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CONFIRM',
      entity: 'Procurement',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CONFIRMED', txnNo: txn.txnNo },
    });
    return doc;
  });
}

/**
 * Cancels a DRAFT (no stock effect) or a CONFIRMED document (appends a reversal; refused with 409
 * if the received stock has since been consumed and reversing would make stock negative).
 */
export async function cancel(id: string, reason: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CANCELLED') throw conflict('Procurement is already cancelled');
    let reversalNo: string | undefined;
    if (d.status === 'CONFIRMED') {
      const returns = await tx.supplierReturn.findMany({
        where: { procurementId: id, status: 'CONFIRMED' },
        select: { returnNo: true },
      });
      if (returns.length)
        throw conflict(
          `Cannot cancel ${d.grnNo}: supplier returns ${returns.map((r) => r.returnNo).join(', ')} are confirmed against it. Cancel them first`,
        );
      try {
        reversalNo = (await reverse(d.txnId!, `${d.grnNo} cancelled: ${reason}`, userId, { tx }))
          .txnNo;
      } catch (e) {
        try {
          await explainShortage(tx, e);
        } catch (x) {
          if (x instanceof HttpError && x.status === 409) {
            throw conflict(`Cannot cancel ${d.grnNo}: ${x.message}`, x.details);
          }
          throw x;
        }
      }
    }
    const doc = await tx.procurement.update({
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
      entity: 'Procurement',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CANCELLED', reason, reversalNo },
    });
    return doc;
  });
}

export async function get(id: string) {
  const d = await prisma.procurement.findUnique({ where: { id }, include });
  if (!d) throw notFoundDoc();
  return d;
}

export async function list(q: DocListQuery) {
  const where: Prisma.ProcurementWhereInput = {
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
            { grnNo: { contains: q.q, mode: 'insensitive' } },
            { remarks: { contains: q.q, mode: 'insensitive' } },
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
    prisma.procurement.findMany({
      where,
      include,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.procurement.count({ where }),
  ]);
  return { data: rows.map(serialize), page: q.page, pageSize: q.pageSize, total };
}
