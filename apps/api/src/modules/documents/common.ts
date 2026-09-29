import { Prisma } from '@prisma/client';
import type { Role } from '@inventory/shared';
import { businessToday } from '../../lib/dates';
import { HttpError, badRequest, conflict, forbidden, unprocessable } from '../../lib/errors';
import type { Tx } from '../../lib/prisma';

const D = Prisma.Decimal;
export const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const idemKey = (h: string | string[] | undefined) => {
  const v = Array.isArray(h) ? h[0] : h;
  if (v && v.length > 100) throw badRequest('Idempotency-Key too long');
  return v || undefined;
};

/** Only MANAGER/ADMIN may confirm documents dated before today. */
export function assertBackdateAllowed(role: Role, txnDate: string) {
  if (txnDate < businessToday() && role !== 'ADMIN' && role !== 'MANAGER') {
    throw forbidden('Only a manager or admin can post backdated transactions');
  }
}

export async function defaultWarehouseId(tx: Tx, requested?: string) {
  const w = requested
    ? await tx.warehouse.findUnique({ where: { id: requested } })
    : await tx.warehouse.findFirst({ where: { isDefault: true } });
  if (!w)
    throw unprocessable(requested ? 'Warehouse does not exist' : 'No default warehouse configured');
  if (!w.active) throw unprocessable(`Warehouse ${w.code} is inactive`);
  return w.id;
}

export interface LineIn {
  itemId: string;
  unitId?: string;
}

/**
 * Validates every line's item (exists, active) and unit (must be the item's own unit — units are
 * never mixed). Returns items by id so callers can default GST rate etc.
 */
export async function resolveItems(tx: Tx, lines: LineIn[]) {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const items = await tx.item.findMany({ where: { id: { in: ids } }, include: { unit: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const problems: string[] = [];
  lines.forEach((l, i) => {
    const item = byId.get(l.itemId);
    if (!item) return problems.push(`Line ${i + 1}: item does not exist`);
    if (!item.active) problems.push(`Line ${i + 1}: item ${item.code} is inactive`);
    if (l.unitId && l.unitId !== item.unitId) {
      problems.push(`Line ${i + 1}: unit does not match item ${item.code} (${item.unit.code})`);
    }
  });
  if (problems.length) throw unprocessable(problems.join('; '), { problems });
  return byId;
}

export const dec = (v: string | number | Prisma.Decimal) => new D(v);

/** Turns a unique-violation on a document number into a friendly 409. */
export function mapDuplicate(e: unknown, label: string, no: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw conflict(`${label} "${no}" already exists`, { field: label });
  }
  throw e;
}

export interface Shortage {
  itemId: string;
  available: string;
  requested: string;
}

/** Adds item codes to the stock-shortage details produced by the inventory service. */
export async function explainShortage(tx: Tx, e: unknown): Promise<never> {
  if (
    e instanceof HttpError &&
    e.status === 409 &&
    (e.details as { shortages?: Shortage[] })?.shortages
  ) {
    const shortages = (e.details as { shortages: Shortage[] }).shortages;
    const items = await tx.item.findMany({ where: { id: { in: shortages.map((s) => s.itemId) } } });
    const code = new Map(items.map((i) => [i.id, i.code]));
    const detail = shortages.map((s) => ({ ...s, itemCode: code.get(s.itemId) ?? s.itemId }));
    throw conflict(
      `Insufficient stock: ${detail.map((s) => `${s.itemCode} (available ${s.available}, needed ${s.requested})`).join(', ')}`,
      { shortages: detail },
    );
  }
  throw e;
}
