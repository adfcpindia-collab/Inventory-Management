import { Prisma } from '@prisma/client';
import type { ConversionTemplateInput } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { dec, resolveItems } from '../documents/common';

const D = Prisma.Decimal;
const lineInclude = {
  item: { select: { code: true, name: true, unit: { select: { code: true } } } },
};
const include = {
  inputs: { orderBy: { lineNo: 'asc' as const }, include: lineInclude },
  outputs: { orderBy: { lineNo: 'asc' as const }, include: lineInclude },
};

const snapshot = (t: { name: string; active: boolean; inputs: unknown[]; outputs: unknown[] }) => ({
  name: t.name,
  active: t.active,
  inputs: t.inputs.length,
  outputs: t.outputs.length,
});

const dupName = (e: unknown, name: string): never => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw conflict(`A template named "${name}" already exists`);
  }
  throw e;
};

async function lines(tx: Tx, l: ConversionTemplateInput['inputs']) {
  await resolveItems(tx, l); // exists, active, unit is the item's unit
  return l.map((x, i) => ({ lineNo: i + 1, itemId: x.itemId, qty: dec(x.qty) }));
}

export async function create(input: ConversionTemplateInput, userId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const t = await tx.conversionTemplate.create({
        data: {
          name: input.name,
          description: input.description,
          createdById: userId,
          inputs: { create: await lines(tx, input.inputs) },
          outputs: { create: await lines(tx, input.outputs) },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'CREATE',
        entity: 'ConversionTemplate',
        entityId: t.id,
        newValue: snapshot(t),
      });
      return t;
    });
  } catch (e) {
    return dupName(e, input.name);
  }
}

export async function update(id: string, input: ConversionTemplateInput, userId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const old = await tx.conversionTemplate.findUnique({ where: { id }, include });
      if (!old) throw notFound('Template not found');
      await tx.conversionTemplateInput.deleteMany({ where: { templateId: id } });
      await tx.conversionTemplateOutput.deleteMany({ where: { templateId: id } });
      const t = await tx.conversionTemplate.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description ?? null,
          inputs: { create: await lines(tx, input.inputs) },
          outputs: { create: await lines(tx, input.outputs) },
        },
        include,
      });
      await writeAudit(tx, {
        userId,
        action: 'UPDATE',
        entity: 'ConversionTemplate',
        entityId: id,
        oldValue: snapshot(old),
        newValue: snapshot(t),
      });
      return t;
    });
  } catch (e) {
    return dupName(e, input.name);
  }
}

/** Soft delete only. Deactivating an already-inactive template is a 409 (as for masters). */
export async function setActive(id: string, active: boolean, userId: string) {
  return prisma.$transaction(async (tx) => {
    const old = await tx.conversionTemplate.findUnique({ where: { id } });
    if (!old) throw notFound('Template not found');
    if (old.active === active)
      throw conflict(`Template is already ${active ? 'active' : 'inactive'}`);
    const t = await tx.conversionTemplate.update({ where: { id }, data: { active }, include });
    await writeAudit(tx, {
      userId,
      action: active ? 'ACTIVATE' : 'DEACTIVATE',
      entity: 'ConversionTemplate',
      entityId: id,
      oldValue: { active: old.active },
      newValue: { active },
    });
    return t;
  });
}

export async function get(id: string) {
  const t = await prisma.conversionTemplate.findUnique({ where: { id }, include });
  if (!t) throw notFound('Template not found');
  return t;
}

export async function list(q: {
  q?: string;
  status: 'active' | 'inactive' | 'all';
  page: number;
  pageSize: number;
}) {
  const where: Prisma.ConversionTemplateWhereInput = {
    ...(q.status === 'all' ? {} : { active: q.status === 'active' }),
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: 'insensitive' } },
            { description: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.conversionTemplate.findMany({
      where,
      include,
      orderBy: { name: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.conversionTemplate.count({ where }),
  ]);
  return { data, page: q.page, pageSize: q.pageSize, total };
}

export interface ExpandedLine {
  itemId: string;
  qty: string;
}

/**
 * Scales a template's per-unit quantities by `multiplier` using exact decimal arithmetic. A result
 * that would need more than 3 decimal places is rejected rather than silently rounded.
 */
export function scale(
  t: {
    inputs: { itemId: string; qty: Prisma.Decimal }[];
    outputs: { itemId: string; qty: Prisma.Decimal }[];
  },
  multiplier: number | string,
) {
  const m = new D(multiplier);
  const one = (l: { itemId: string; qty: Prisma.Decimal }, kind: string): ExpandedLine => {
    const q = l.qty.times(m);
    if (q.decimalPlaces() > 3) {
      throw unprocessable(
        `Multiplier ${multiplier} gives ${q.toString()} for an ${kind} — more than 3 decimal places`,
      );
    }
    return { itemId: l.itemId, qty: q.toString() };
  };
  return {
    inputs: t.inputs.map((l) => one(l, 'input')),
    outputs: t.outputs.map((l) => one(l, 'output')),
  };
}

export async function expand(id: string, multiplier: number | string) {
  const t = await get(id);
  return { templateId: id, multiplier: String(multiplier), ...scale(t, multiplier) };
}

export async function loadActiveForUse(tx: Tx, id: string) {
  const t = await tx.conversionTemplate.findUnique({ where: { id }, include });
  if (!t) throw unprocessable('Template does not exist');
  if (!t.active) throw unprocessable(`Template "${t.name}" is inactive`);
  return t;
}
