import { Prisma } from '@prisma/client';
import type { DispatchInput, DocListQuery, Role } from '@inventory/shared';
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
  client: { select: { id: true, companyName: true, address: true, gstin: true, phone: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { name: true } },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    include: { item: { select: { code: true, name: true } }, unit: { select: { code: true } } },
  },
};
type Doc = Prisma.DispatchGetPayload<{ include: typeof include }>;

export function serialize(d: Doc) {
  const total = d.lines.reduce((a, l) => a.plus(l.amount ?? 0), dec(0));
  const { txnDate, ...rest } = d;
  return { ...rest, txnDate: fromDbDate(txnDate), totals: { total: round2(total).toFixed(2) } };
}

async function buildLines(tx: Tx, lines: DispatchInput['lines']) {
  const items = await resolveItems(tx, lines);
  return lines.map((l, i) => ({
    lineNo: i + 1,
    itemId: l.itemId,
    unitId: items.get(l.itemId)!.unitId,
    qty: dec(l.qty),
    rate: l.rate === undefined ? null : dec(l.rate),
    amount: l.rate === undefined ? null : round2(dec(l.qty).times(l.rate)),
  }));
}

async function loadClient(tx: Tx, id: string) {
  const c = await tx.client.findUnique({ where: { id } });
  if (!c) throw unprocessable('Client does not exist');
  if (!c.active) throw unprocessable(`Client ${c.companyName} is inactive`);
  return c;
}

const auditSnapshot = (d: Doc) => ({
  challanNo: d.challanNo,
  status: d.status,
  lines: d.lines.length,
  clientId: d.clientId,
});

async function lockDoc(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM dispatches WHERE id = ${id}::uuid FOR UPDATE`;
  const d = await tx.dispatch.findUnique({ where: { id }, include });
  if (!d) throw notFound('Dispatch not found');
  return d;
}

export async function create(input: DispatchInput, userId: string, idempotencyKey?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const prior = await tx.dispatch.findUnique({ where: { idempotencyKey }, include });
        if (prior) return prior;
      }
      const client = await loadClient(tx, input.clientId);
      const lines = await buildLines(tx, input.lines);
      const doc = await tx.dispatch.create({
        data: {
          challanNo: input.challanNo,
          txnDate: toDbDate(input.txnDate),
          clientId: input.clientId,
          warehouseId: await defaultWarehouseId(tx, input.warehouseId),
          address: input.address ?? client.address,
          vehicleNo: input.vehicleNo,
          driverName: input.driverName,
          salesOrderNo: input.salesOrderNo,
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
        entity: 'Dispatch',
        entityId: doc.id,
        newValue: auditSnapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    if (idempotencyKey) {
      const prior = await prisma.dispatch.findUnique({ where: { idempotencyKey }, include });
      if (prior) return prior;
    }
    return mapDuplicate(e, 'Challan number', input.challanNo);
  }
}

export async function update(id: string, input: DispatchInput, userId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const old = await lockDoc(tx, id);
      if (old.status !== 'DRAFT')
        throw conflict(`Only DRAFT dispatches can be edited (this one is ${old.status})`);
      const client = await loadClient(tx, input.clientId);
      const lines = await buildLines(tx, input.lines);
      await tx.dispatchItem.deleteMany({ where: { dispatchId: id } });
      const doc = await tx.dispatch.update({
        where: { id },
        data: {
          challanNo: input.challanNo,
          txnDate: toDbDate(input.txnDate),
          clientId: input.clientId,
          warehouseId: await defaultWarehouseId(tx, input.warehouseId),
          address: input.address ?? client.address,
          vehicleNo: input.vehicleNo ?? null,
          driverName: input.driverName ?? null,
          salesOrderNo: input.salesOrderNo ?? null,
          remarks: input.remarks ?? null,
          lines: { create: lines },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'UPDATE',
        entity: 'Dispatch',
        entityId: id,
        oldValue: auditSnapshot(old),
        newValue: auditSnapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    return mapDuplicate(e, 'Challan number', input.challanNo);
  }
}

/**
 * DRAFT → CONFIRMED: checks USABLE stock for every line and posts one DISPATCH transaction in the
 * same DB transaction as the status change. If any line is short the whole challan is rejected and
 * nothing changes. Repeating the call on an already-confirmed challan returns it unchanged.
 */
export async function confirm(id: string, userId: string, role: Role) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CONFIRMED') return d;
    if (d.status === 'CANCELLED') throw conflict('A cancelled dispatch cannot be confirmed');
    if (d.lines.length === 0) throw unprocessable('Add at least one item before confirming');
    const date = fromDbDate(d.txnDate);
    assertBackdateAllowed(role, date);
    await loadClient(tx, d.clientId);

    let txn;
    try {
      txn = await post(
        {
          type: 'DISPATCH',
          txnDate: date,
          userId,
          clientId: d.clientId,
          referenceType: 'DISPATCH',
          referenceId: d.id,
          referenceNo: d.challanNo,
          remarks: d.remarks ?? undefined,
          idempotencyKey: `dispatch-confirm:${d.id}`,
          lines: d.lines.map((l) => ({
            itemId: l.itemId,
            warehouseId: d.warehouseId,
            direction: 'OUT' as const,
            stockStatus: 'USABLE' as const,
            qty: l.qty.toString(),
            unitCost: l.rate?.toString(),
          })),
        },
        tx,
      );
    } catch (e) {
      return explainShortage(tx, e);
    }
    const doc = await tx.dispatch.update({
      where: { id },
      data: { status: 'CONFIRMED', txnId: txn.id, confirmedAt: new Date(), confirmedById: userId },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CONFIRM',
      entity: 'Dispatch',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CONFIRMED', txnNo: txn.txnNo },
    });
    return doc;
  });
}

/** Cancels a DRAFT (no stock effect) or a CONFIRMED challan (reversal returns the stock). */
export async function cancel(id: string, reason: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CANCELLED') throw conflict('Dispatch is already cancelled');
    let reversalNo: string | undefined;
    if (d.status === 'CONFIRMED') {
      const returns = await tx.customerReturn.findMany({
        where: { dispatchId: id, status: 'CONFIRMED' },
        select: { returnNo: true },
      });
      if (returns.length)
        throw conflict(
          `Cannot cancel ${d.challanNo}: customer returns ${returns.map((r) => r.returnNo).join(', ')} are confirmed against it. Cancel them first`,
        );
      try {
        reversalNo = (
          await reverse(d.txnId!, `${d.challanNo} cancelled: ${reason}`, userId, { tx })
        ).txnNo;
      } catch (e) {
        try {
          await explainShortage(tx, e);
        } catch (x) {
          if (x instanceof HttpError && x.status === 409)
            throw conflict(`Cannot cancel ${d.challanNo}: ${x.message}`, x.details);
          throw x;
        }
      }
    }
    const doc = await tx.dispatch.update({
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
      entity: 'Dispatch',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CANCELLED', reason, reversalNo },
    });
    return doc;
  });
}

export async function get(id: string) {
  const d = await prisma.dispatch.findUnique({ where: { id }, include });
  if (!d) throw notFound('Dispatch not found');
  return d;
}

export async function list(q: DocListQuery) {
  const where: Prisma.DispatchWhereInput = {
    ...(q.status !== 'all' ? { status: q.status } : {}),
    ...(q.partyId ? { clientId: q.partyId } : {}),
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
            { challanNo: { contains: q.q, mode: 'insensitive' } },
            { salesOrderNo: { contains: q.q, mode: 'insensitive' } },
            { vehicleNo: { contains: q.q, mode: 'insensitive' } },
            { remarks: { contains: q.q, mode: 'insensitive' } },
            { client: { companyName: { contains: q.q, mode: 'insensitive' } } },
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
    prisma.dispatch.findMany({
      where,
      include,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.dispatch.count({ where }),
  ]);
  return { data: rows.map(serialize), page: q.page, pageSize: q.pageSize, total };
}
