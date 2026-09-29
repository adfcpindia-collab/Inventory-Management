import { Prisma } from '@prisma/client';
import {
  CONDITION_BUCKET,
  type CustomerReturnInput,
  type DocListQuery,
  type Role,
} from '@inventory/shared';
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
  client: { select: { id: true, companyName: true } },
  dispatch: { select: { id: true, challanNo: true, txnDate: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { name: true } },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    include: { item: { select: { code: true, name: true } }, unit: { select: { code: true } } },
  },
};
type Doc = Prisma.CustomerReturnGetPayload<{ include: typeof include }>;

export function serialize(d: Doc) {
  const { txnDate, dispatch, ...rest } = d;
  return {
    ...rest,
    txnDate: fromDbDate(txnDate),
    dispatch: { ...dispatch, txnDate: fromDbDate(dispatch.txnDate) },
    totals: { qty: d.lines.reduce((a, l) => a.plus(l.qty), dec(0)).toString() },
  };
}

const snapshot = (d: Doc) => ({
  returnNo: d.returnNo,
  status: d.status,
  dispatchId: d.dispatchId,
  lines: d.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString(), condition: l.condition })),
});

/** The original challan must be CONFIRMED; its lines are what can be returned. */
async function loadDispatch(tx: Tx, id: string) {
  const d = await tx.dispatch.findUnique({ where: { id }, include: { lines: true } });
  if (!d) throw unprocessable('Original challan does not exist');
  if (d.status !== 'CONFIRMED')
    throw unprocessable(
      `Challan ${d.challanNo} is ${d.status}; only confirmed challans can be returned`,
    );
  return d;
}

/** Validates lines against the challan: right items, and total returned ≤ dispatched. */
async function validateAgainstChallan(
  tx: Tx,
  dispatch: Awaited<ReturnType<typeof loadDispatch>>,
  lines: { itemId: string; qty: string | number | Prisma.Decimal }[],
  selfId?: string,
) {
  const prior = await tx.customerReturnItem.findMany({
    where: { ret: { dispatchId: dispatch.id, status: 'CONFIRMED', id: { not: selfId } } },
    select: { itemId: true, qty: true },
  });
  await assertWithinOriginal(tx, {
    label: `challan ${dispatch.challanNo}`,
    original: dispatch.lines,
    prior,
    mine: lines.map((l) => ({ itemId: l.itemId, qty: dec(l.qty) })),
  });
}

async function build(tx: Tx, input: CustomerReturnInput, selfId?: string) {
  const dispatch = await loadDispatch(tx, input.dispatchId);
  if (input.txnDate < fromDbDate(dispatch.txnDate))
    throw unprocessable('Return date cannot be before the challan date');
  const items = await resolveItems(tx, input.lines);
  await validateAgainstChallan(tx, dispatch, input.lines, selfId);
  return {
    dispatch,
    warehouseId: await defaultWarehouseId(tx, input.warehouseId ?? dispatch.warehouseId),
    lines: input.lines.map((l, i) => ({
      lineNo: i + 1,
      itemId: l.itemId,
      unitId: items.get(l.itemId)!.unitId,
      qty: dec(l.qty),
      condition: l.condition,
      reason: l.reason ?? null,
    })),
  };
}

async function lockDoc(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM customer_returns WHERE id = ${id}::uuid FOR UPDATE`;
  const d = await tx.customerReturn.findUnique({ where: { id }, include });
  if (!d) throw notFound('Customer return not found');
  return d;
}

export async function create(input: CustomerReturnInput, userId: string, idempotencyKey?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const prior = await tx.customerReturn.findUnique({ where: { idempotencyKey }, include });
        if (prior) return prior;
      }
      const b = await build(tx, input);
      const doc = await tx.customerReturn.create({
        data: {
          returnNo: input.returnNo,
          txnDate: toDbDate(input.txnDate),
          clientId: b.dispatch.clientId,
          dispatchId: b.dispatch.id,
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
        entity: 'CustomerReturn',
        entityId: doc.id,
        newValue: snapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    if (idempotencyKey) {
      const prior = await prisma.customerReturn.findUnique({ where: { idempotencyKey }, include });
      if (prior) return prior;
    }
    return mapDuplicate(e, 'Return number', input.returnNo);
  }
}

export async function update(id: string, input: CustomerReturnInput, userId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const old = await lockDoc(tx, id);
      if (old.status !== 'DRAFT')
        throw conflict(`Only DRAFT returns can be edited (this one is ${old.status})`);
      const b = await build(tx, input, id);
      await tx.customerReturnItem.deleteMany({ where: { returnId: id } });
      const doc = await tx.customerReturn.update({
        where: { id },
        data: {
          returnNo: input.returnNo,
          txnDate: toDbDate(input.txnDate),
          clientId: b.dispatch.clientId,
          dispatchId: b.dispatch.id,
          warehouseId: b.warehouseId,
          remarks: input.remarks ?? null,
          lines: { create: b.lines },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'UPDATE',
        entity: 'CustomerReturn',
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
 * DRAFT → CONFIRMED. Re-checks the over-return rule while the challan row is locked, then posts one
 * CUSTOMER_RETURN transaction. GOOD lines enter USABLE stock; DAMAGED / NEEDS_INSPECTION lines go to
 * their own buckets and are never available for dispatch until moved by a later action.
 */
export async function confirm(id: string, userId: string, role: Role) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CONFIRMED') return d;
    if (d.status === 'CANCELLED') throw conflict('A cancelled return cannot be confirmed');
    if (d.lines.length === 0) throw unprocessable('Add at least one item before confirming');
    const date = fromDbDate(d.txnDate);
    assertBackdateAllowed(role, date);

    // Serialises concurrent returns (and a challan cancel) against the same challan.
    await tx.$queryRaw`SELECT id FROM dispatches WHERE id = ${d.dispatchId}::uuid FOR UPDATE`;
    const dispatch = await loadDispatch(tx, d.dispatchId);
    await validateAgainstChallan(tx, dispatch, d.lines, id);

    const txn = await post(
      {
        type: 'CUSTOMER_RETURN',
        txnDate: date,
        userId,
        clientId: d.clientId,
        referenceType: 'CUSTOMER_RETURN',
        referenceId: d.id,
        referenceNo: d.returnNo,
        remarks: d.remarks ?? undefined,
        idempotencyKey: `customer-return-confirm:${d.id}`,
        lines: d.lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: d.warehouseId,
          direction: 'IN' as const,
          stockStatus: CONDITION_BUCKET[l.condition],
          qty: l.qty.toString(),
        })),
      },
      tx,
    );
    const doc = await tx.customerReturn.update({
      where: { id },
      data: { status: 'CONFIRMED', txnId: txn.id, confirmedAt: new Date(), confirmedById: userId },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CONFIRM',
      entity: 'CustomerReturn',
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
    if (d.status === 'CANCELLED') throw conflict('Customer return is already cancelled');
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
    const doc = await tx.customerReturn.update({
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
      entity: 'CustomerReturn',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CANCELLED', reason, reversalNo },
    });
    return doc;
  });
}

export async function get(id: string) {
  const d = await prisma.customerReturn.findUnique({ where: { id }, include });
  if (!d) throw notFound('Customer return not found');
  return d;
}

export async function list(q: DocListQuery) {
  const where: Prisma.CustomerReturnWhereInput = {
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
            { returnNo: { contains: q.q, mode: 'insensitive' } },
            { remarks: { contains: q.q, mode: 'insensitive' } },
            { dispatch: { challanNo: { contains: q.q, mode: 'insensitive' } } },
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
    prisma.customerReturn.findMany({
      where,
      include,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.customerReturn.count({ where }),
  ]);
  return { data: rows.map(serialize), page: q.page, pageSize: q.pageSize, total };
}
