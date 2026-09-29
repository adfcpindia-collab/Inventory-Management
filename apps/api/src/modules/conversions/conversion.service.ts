import { Prisma } from '@prisma/client';
import type { ConversionInput, DocListQuery, Role } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { fromDbDate, toDbDate } from '../../lib/dates';
import { HttpError, conflict, notFound, unprocessable } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { loadActiveForUse, scale } from '../conversion-templates/template.service';
import {
  assertBackdateAllowed,
  dec,
  defaultWarehouseId,
  explainShortage,
  resolveItems,
} from '../documents/common';
import { post, reverse } from '../inventory/inventory.service';
import { getConversionThreshold } from '../settings/settings.service';

const lineInclude = {
  orderBy: { lineNo: 'asc' as const },
  include: { item: { select: { code: true, name: true } }, unit: { select: { code: true } } },
};
const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  template: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  inputs: lineInclude,
  outputs: lineInclude,
};
type Doc = Prisma.ConversionGetPayload<{ include: typeof include }>;

const sum = (ls: { qty: Prisma.Decimal }[]) => ls.reduce((a, l) => a.plus(l.qty), dec(0));

export function serialize(d: Doc) {
  const { txnDate, ...rest } = d;
  return {
    ...rest,
    txnDate: fromDbDate(txnDate),
    totals: { inputQty: sum(d.inputs).toString(), outputQty: sum(d.outputs).toString() },
  };
}

const snapshot = (d: Doc) => ({
  conversionNo: d.conversionNo,
  status: d.status,
  inputs: d.inputs.length,
  outputs: d.outputs.length,
  templateId: d.templateId,
});

interface RawLine {
  itemId: string;
  qty: string | number;
  unitId?: string;
}

/** Resolves the final input/output lines (explicit, or template × multiplier) and validates them. */
async function buildLines(tx: Tx, input: ConversionInput) {
  let inputs: RawLine[];
  let outputs: RawLine[];
  let templateId: string | null = null;
  if (input.templateId) {
    const t = await loadActiveForUse(tx, input.templateId);
    templateId = t.id;
  }
  if (input.inputs?.length && input.outputs?.length) {
    inputs = input.inputs;
    outputs = input.outputs;
  } else if (input.templateId) {
    const t = await loadActiveForUse(tx, input.templateId);
    ({ inputs, outputs } = scale(t, input.multiplier));
  } else {
    throw unprocessable('Pick a template or add at least one input and one output');
  }
  const outIds = new Set(outputs.map((l) => l.itemId));
  if (inputs.some((l) => outIds.has(l.itemId))) {
    throw unprocessable('An item cannot be both an input and an output of the same conversion');
  }
  const items = await resolveItems(tx, [...inputs, ...outputs]);
  const map = (ls: RawLine[]) =>
    ls.map((l, i) => ({
      lineNo: i + 1,
      itemId: l.itemId,
      unitId: items.get(l.itemId)!.unitId,
      qty: dec(l.qty),
    }));
  return { templateId, inputs: map(inputs), outputs: map(outputs) };
}

async function lockDoc(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM conversions WHERE id = ${id}::uuid FOR UPDATE`;
  const d = await tx.conversion.findUnique({ where: { id }, include });
  if (!d) throw notFound('Conversion not found');
  return d;
}

export async function create(input: ConversionInput, userId: string, idempotencyKey?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const prior = await tx.conversion.findUnique({ where: { idempotencyKey }, include });
        if (prior) return prior;
      }
      const built = await buildLines(tx, input);
      const doc = await tx.conversion.create({
        data: {
          txnDate: toDbDate(input.txnDate),
          warehouseId: await defaultWarehouseId(tx, input.warehouseId),
          templateId: built.templateId,
          multiplier: dec(input.multiplier),
          remarks: input.remarks,
          idempotencyKey,
          createdById: userId,
          inputs: { create: built.inputs },
          outputs: { create: built.outputs },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'CREATE',
        entity: 'Conversion',
        entityId: doc.id,
        newValue: snapshot(doc),
      });
      return doc;
    });
  } catch (e) {
    if (idempotencyKey) {
      const prior = await prisma.conversion.findUnique({ where: { idempotencyKey }, include });
      if (prior) return prior;
    }
    throw e;
  }
}

export async function update(id: string, input: ConversionInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const old = await lockDoc(tx, id);
    if (old.status !== 'DRAFT')
      throw conflict(`Only DRAFT conversions can be edited (this one is ${old.status})`);
    const built = await buildLines(tx, input);
    await tx.conversionInput.deleteMany({ where: { conversionId: id } });
    await tx.conversionOutput.deleteMany({ where: { conversionId: id } });
    const doc = await tx.conversion.update({
      where: { id },
      data: {
        txnDate: toDbDate(input.txnDate),
        warehouseId: await defaultWarehouseId(tx, input.warehouseId),
        templateId: built.templateId,
        multiplier: dec(input.multiplier),
        remarks: input.remarks ?? null,
        // any edit invalidates a pending/granted approval
        approvalStatus: 'NONE',
        approvedById: null,
        approvedAt: null,
        inputs: { create: built.inputs },
        outputs: { create: built.outputs },
      },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'Conversion',
      entityId: id,
      oldValue: snapshot(old),
      newValue: snapshot(doc),
    });
    return doc;
  });
}

/**
 * DRAFT → CONFIRMED. Posts CONVERSION_OUT (inputs) then CONVERSION_IN (outputs) — two ledger
 * headers sharing group_id = conversion no. — plus the status change in ONE DB transaction, so a
 * failure anywhere leaves stock and the document untouched.
 *
 * If a threshold is configured and total input quantity exceeds it, a STORE user's confirm only
 * marks the draft approval-PENDING (returned as-is, HTTP 202); a MANAGER/ADMIN confirming counts as
 * the approval.
 */
export async function confirm(id: string, userId: string, role: Role) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CONFIRMED') return d;
    if (d.status === 'CANCELLED') throw conflict('A cancelled conversion cannot be confirmed');
    if (!d.inputs.length || !d.outputs.length)
      throw unprocessable('A conversion needs at least one input and one output');
    const date = fromDbDate(d.txnDate);
    assertBackdateAllowed(role, date);
    await resolveItems(tx, [...d.inputs, ...d.outputs]); // still active, units unchanged

    const threshold = await getConversionThreshold(tx);
    const needsApproval = threshold !== null && sum(d.inputs).gt(threshold);
    const isManager = role === 'MANAGER' || role === 'ADMIN';
    if (needsApproval && !isManager) {
      if (d.approvalStatus === 'PENDING') return d;
      const pending = await tx.conversion.update({
        where: { id },
        data: { approvalStatus: 'PENDING' },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'REQUEST_APPROVAL',
        entity: 'Conversion',
        entityId: id,
        newValue: { inputQty: sum(d.inputs).toString(), threshold },
      });
      return pending;
    }

    const base = {
      txnDate: date,
      userId,
      referenceType: 'CONVERSION',
      referenceId: d.id,
      referenceNo: d.conversionNo,
      groupId: d.conversionNo,
      remarks: d.remarks ?? undefined,
    };
    let outTxn;
    let inTxn;
    try {
      outTxn = await post(
        {
          ...base,
          type: 'CONVERSION_OUT',
          idempotencyKey: `conversion-out:${d.id}`,
          lines: d.inputs.map((l) => ({
            itemId: l.itemId,
            warehouseId: d.warehouseId,
            direction: 'OUT' as const,
            stockStatus: 'USABLE' as const,
            qty: l.qty.toString(),
          })),
        },
        tx,
      );
      inTxn = await post(
        {
          ...base,
          type: 'CONVERSION_IN',
          idempotencyKey: `conversion-in:${d.id}`,
          lines: d.outputs.map((l) => ({
            itemId: l.itemId,
            warehouseId: d.warehouseId,
            direction: 'IN' as const,
            stockStatus: 'USABLE' as const,
            qty: l.qty.toString(),
          })),
        },
        tx,
      );
    } catch (e) {
      return explainShortage(tx, e);
    }
    const doc = await tx.conversion.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        outTxnId: outTxn.id,
        inTxnId: inTxn.id,
        confirmedAt: new Date(),
        confirmedById: userId,
        ...(needsApproval
          ? { approvalStatus: 'APPROVED' as const, approvedById: userId, approvedAt: new Date() }
          : {}),
      },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CONFIRM',
      entity: 'Conversion',
      entityId: id,
      oldValue: { status: d.status },
      newValue: {
        status: 'CONFIRMED',
        out: outTxn.txnNo,
        in: inTxn.txnNo,
        approved: needsApproval,
      },
    });
    return doc;
  });
}

/**
 * Cancels a DRAFT (no stock effect) or reverses a CONFIRMED conversion: outputs are taken back out
 * first, then the inputs are returned — both reversals in one transaction. If the outputs have
 * already been consumed the reversal would drive stock negative, so it is refused (409) and
 * nothing changes.
 */
export async function cancel(id: string, reason: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const d = await lockDoc(tx, id);
    if (d.status === 'CANCELLED') throw conflict('Conversion is already cancelled');
    const reversals: string[] = [];
    if (d.status === 'CONFIRMED') {
      const why = `${d.conversionNo} cancelled: ${reason}`;
      try {
        reversals.push((await reverse(d.inTxnId!, why, userId, { tx })).txnNo);
        reversals.push((await reverse(d.outTxnId!, why, userId, { tx })).txnNo);
      } catch (e) {
        try {
          await explainShortage(tx, e);
        } catch (x) {
          if (x instanceof HttpError && x.status === 409) {
            throw conflict(`Cannot reverse ${d.conversionNo}: ${x.message}`, x.details);
          }
          throw x;
        }
      }
    }
    const doc = await tx.conversion.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelledById: userId,
        approvalStatus: d.approvalStatus === 'PENDING' ? 'NONE' : d.approvalStatus,
      },
      include,
    });
    await writeAudit(tx, {
      userId,
      action: 'CANCEL',
      entity: 'Conversion',
      entityId: id,
      oldValue: { status: d.status },
      newValue: { status: 'CANCELLED', reason, reversals },
    });
    return doc;
  });
}

export async function get(id: string) {
  const d = await prisma.conversion.findUnique({ where: { id }, include });
  if (!d) throw notFound('Conversion not found');
  return d;
}

export async function list(q: DocListQuery) {
  const itemMatch = (s: string) => ({
    item: {
      OR: [
        { code: { contains: s, mode: 'insensitive' as const } },
        { name: { contains: s, mode: 'insensitive' as const } },
      ],
    },
  });
  const where: Prisma.ConversionWhereInput = {
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
            { conversionNo: { contains: q.q, mode: 'insensitive' } },
            { remarks: { contains: q.q, mode: 'insensitive' } },
            { template: { name: { contains: q.q, mode: 'insensitive' } } },
            { inputs: { some: itemMatch(q.q) } },
            { outputs: { some: itemMatch(q.q) } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.conversion.findMany({
      where,
      include,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.conversion.count({ where }),
  ]);
  return { data: rows.map(serialize), page: q.page, pageSize: q.pageSize, total };
}
