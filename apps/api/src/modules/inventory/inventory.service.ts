import { Prisma } from '@prisma/client';
import type { StockStatus, TxnType } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { businessToday, fromDbDate, toDbDate } from '../../lib/dates';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export interface PostLine {
  itemId: string;
  warehouseId: string;
  direction: 'IN' | 'OUT';
  /** Strictly positive; string or number, max 3 decimals. */
  qty: string | number;
  stockStatus?: StockStatus;
  unitCost?: string | number | null;
  batchNo?: string | null;
  serialNo?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
}

export interface PostInput {
  type: Exclude<TxnType, 'REVERSAL'>;
  /** Business date, YYYY-MM-DD. Must not be in the future. */
  txnDate: string;
  lines: PostLine[];
  userId: string;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  clientId?: string;
  supplierId?: string;
  groupId?: string;
  remarks?: string;
  idempotencyKey?: string;
}

export interface InsufficientStockDetail {
  itemId: string;
  warehouseId: string;
  stockStatus: StockStatus;
  available: string;
  requested: string;
}

const key = (l: { itemId: string; warehouseId: string; stockStatus: StockStatus }) =>
  `${l.itemId}|${l.warehouseId}|${l.stockStatus}`;

function parseQty(v: string | number): Dec {
  let d: Dec;
  try {
    d = new D(v);
  } catch {
    throw badRequest(`Invalid quantity "${v}"`);
  }
  if (!d.isFinite() || d.lte(0)) throw badRequest('Quantity must be greater than 0');
  if (d.decimalPlaces() > 3) throw badRequest('Quantity allows at most 3 decimal places');
  if (d.gte(new D('1e15'))) throw badRequest('Quantity too large');
  return d;
}

const dateOrNull = (s?: string | null) => (s ? toDbDate(s) : null);

const txnInclude = { lines: { orderBy: { lineNo: 'asc' as const } } };
export type PostedTxn = Prisma.InventoryTransactionGetPayload<{ include: typeof txnInclude }>;

/**
 * The ONLY code allowed to change stock. Every movement is appended to the ledger and the cached
 * balance is updated in the same DB transaction, under a row lock, without ever going negative.
 *
 * Pass `tx` to join a caller's transaction (so a document status change and its stock movement
 * commit or roll back together); otherwise a transaction is opened here.
 */
export async function post(input: PostInput, tx?: Tx): Promise<PostedTxn> {
  if (tx) return postInTx(tx, input);
  try {
    return await prisma.$transaction((t) => postInTx(t, input));
  } catch (e) {
    // Lost an idempotency race against an identical concurrent request: return the winner's result.
    if (
      input.idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const existing = await prisma.inventoryTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: txnInclude,
      });
      if (existing) return existing;
    }
    throw e;
  }
}

async function postInTx(
  tx: Tx,
  input: PostInput,
  opts: { reversesTxnId?: string; skipActiveCheck?: boolean } = {},
): Promise<PostedTxn> {
  if (input.idempotencyKey) {
    const existing = await tx.inventoryTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: txnInclude,
    });
    if (existing) return existing;
  }
  if (input.lines.length === 0) throw badRequest('A transaction needs at least one line');

  const today = businessToday();
  if (input.txnDate > today) throw badRequest('Transaction date cannot be in the future');

  const lines = input.lines.map((l, i) => ({
    ...l,
    lineNo: i + 1,
    stockStatus: (l.stockStatus ?? 'USABLE') as StockStatus,
    qtyDec: parseQty(l.qty),
  }));

  if (!opts.skipActiveCheck) {
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const items = await tx.item.findMany({ where: { id: { in: ids } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) throw unprocessable(`Item ${id} does not exist`);
      if (!item.active) throw unprocessable(`Item ${item.code} is inactive`);
    }
  }
  const whIds = [...new Set(lines.map((l) => l.warehouseId))];
  const whs = await tx.warehouse.findMany({ where: { id: { in: whIds } } });
  for (const id of whIds) {
    const w = whs.find((x) => x.id === id);
    if (!w) throw unprocessable(`Warehouse ${id} does not exist`);
    if (!w.active && !opts.skipActiveCheck) throw unprocessable(`Warehouse ${w.code} is inactive`);
  }

  // Net movement per (item, warehouse, status) bucket.
  const net = new Map<
    string,
    { itemId: string; warehouseId: string; stockStatus: StockStatus; delta: Dec }
  >();
  for (const l of lines) {
    const k = key(l);
    const cur = net.get(k) ?? {
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      stockStatus: l.stockStatus,
      delta: new D(0),
    };
    cur.delta = l.direction === 'IN' ? cur.delta.plus(l.qtyDec) : cur.delta.minus(l.qtyDec);
    net.set(k, cur);
  }

  // Lock buckets in a deterministic order so concurrent posts cannot deadlock.
  const buckets = [...net.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);
  const shortages: InsufficientStockDetail[] = [];
  for (const b of buckets) {
    await tx.$executeRaw`
      INSERT INTO stock_balances (item_id, warehouse_id, stock_status, qty, updated_at)
      VALUES (${b.itemId}::uuid, ${b.warehouseId}::uuid, ${b.stockStatus}::"StockStatus", 0, now())
      ON CONFLICT DO NOTHING`;
    const rows = await tx.$queryRaw<{ qty: Dec }[]>`
      SELECT qty FROM stock_balances
      WHERE item_id = ${b.itemId}::uuid AND warehouse_id = ${b.warehouseId}::uuid
        AND stock_status = ${b.stockStatus}::"StockStatus"
      FOR UPDATE`;
    const current = new D(rows[0]!.qty);
    const next = current.plus(b.delta);
    if (next.isNegative()) {
      shortages.push({
        itemId: b.itemId,
        warehouseId: b.warehouseId,
        stockStatus: b.stockStatus,
        available: current.toFixed(3),
        requested: b.delta.abs().toFixed(3),
      });
      continue;
    }
    await tx.$executeRaw`
      UPDATE stock_balances SET qty = ${next.toFixed(3)}::numeric, updated_at = now()
      WHERE item_id = ${b.itemId}::uuid AND warehouse_id = ${b.warehouseId}::uuid
        AND stock_status = ${b.stockStatus}::"StockStatus"`;
  }
  if (shortages.length) {
    throw conflict('Insufficient stock: this would make stock negative', { shortages });
  }

  // Backdated movements must not make any historical balance negative either.
  if (input.txnDate < today) {
    for (const b of buckets.filter((x) => x.delta.isNegative())) {
      await assertHistoryNonNegative(tx, input.txnDate, b, lines);
    }
  }

  const created = await tx.inventoryTransaction.create({
    data: {
      type: opts.reversesTxnId ? 'REVERSAL' : input.type,
      txnDate: toDbDate(input.txnDate),
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNo: input.referenceNo,
      clientId: input.clientId,
      supplierId: input.supplierId,
      groupId: input.groupId,
      reversesTxnId: opts.reversesTxnId,
      idempotencyKey: input.idempotencyKey,
      remarks: input.remarks,
      createdById: input.userId,
      lines: {
        create: lines.map((l) => ({
          lineNo: l.lineNo,
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          stockStatus: l.stockStatus,
          qtyIn: l.direction === 'IN' ? l.qtyDec : new D(0),
          qtyOut: l.direction === 'OUT' ? l.qtyDec : new D(0),
          unitCost: l.unitCost == null ? null : new D(l.unitCost),
          batchNo: l.batchNo ?? null,
          serialNo: l.serialNo ?? null,
          mfgDate: dateOrNull(l.mfgDate),
          expiryDate: dateOrNull(l.expiryDate),
        })),
      },
    },
    include: txnInclude,
  });

  await writeAudit(tx, {
    userId: input.userId,
    action: opts.reversesTxnId ? 'REVERSE' : 'POST',
    entity: 'InventoryTransaction',
    entityId: created.id,
    newValue: {
      txnNo: created.txnNo,
      type: created.type,
      txnDate: input.txnDate,
      reversesTxnId: opts.reversesTxnId,
      lines: created.lines.map((l) => ({
        itemId: l.itemId,
        warehouseId: l.warehouseId,
        stockStatus: l.stockStatus,
        qtyIn: l.qtyIn.toString(),
        qtyOut: l.qtyOut.toString(),
      })),
    },
  });
  return created;
}

/**
 * For a backdated outward movement: replay each affected bucket's daily net (existing ledger plus
 * this transaction) from the posting date forward and require the running balance never dips below 0.
 */
async function assertHistoryNonNegative(
  tx: Tx,
  txnDate: string,
  b: { itemId: string; warehouseId: string; stockStatus: StockStatus },
  lines: {
    itemId: string;
    warehouseId: string;
    stockStatus: StockStatus;
    direction: 'IN' | 'OUT';
    qtyDec: Dec;
  }[],
) {
  const mine = lines
    .filter((l) => key(l) === key(b))
    .reduce((a, l) => (l.direction === 'IN' ? a.plus(l.qtyDec) : a.minus(l.qtyDec)), new D(0));
  const rows = await tx.$queryRaw<{ day: Date; running: Dec }[]>`
    WITH daily AS (
      SELECT t.txn_date AS day, SUM(l.qty_in - l.qty_out) AS net
      FROM inventory_transaction_items l
      JOIN inventory_transactions t ON t.id = l.txn_id
      WHERE l.item_id = ${b.itemId}::uuid AND l.warehouse_id = ${b.warehouseId}::uuid
        AND l.stock_status = ${b.stockStatus}::"StockStatus"
      GROUP BY t.txn_date
      UNION ALL SELECT ${toDbDate(txnDate)}::date, ${mine.toFixed(3)}::numeric
    )
    SELECT day, SUM(SUM(net)) OVER (ORDER BY day) AS running
    FROM daily GROUP BY day ORDER BY day`;
  const bad = rows.find((r) => fromDbDate(r.day) >= txnDate && new D(r.running).isNegative());
  if (bad) {
    throw conflict(
      `Backdating would make stock negative on ${fromDbDate(bad.day)} (balance ${new D(bad.running).toFixed(3)})`,
      { itemId: b.itemId, warehouseId: b.warehouseId, stockStatus: b.stockStatus },
    );
  }
}

/**
 * Appends a REVERSAL that exactly negates `txnId`. A transaction can be reversed once, a reversal
 * cannot itself be reversed, and the reversal is refused if it would make any balance negative.
 */
export async function reverse(
  txnId: string,
  reason: string,
  userId: string,
  opts: { txnDate?: string; tx?: Tx } = {},
): Promise<PostedTxn> {
  const run = async (tx: Tx) => {
    const orig = await tx.inventoryTransaction.findUnique({
      where: { id: txnId },
      include: { ...txnInclude, reversedBy: true },
    });
    if (!orig) throw notFound('Transaction not found');
    if (orig.type === 'REVERSAL') throw conflict('A reversal cannot be reversed');
    if (orig.reversedBy) throw conflict(`Already reversed by ${orig.reversedBy.txnNo}`);

    const posted = await postInTx(
      tx,
      {
        type: orig.type as Exclude<TxnType, 'REVERSAL'>,
        txnDate: opts.txnDate ?? businessToday(),
        userId,
        referenceType: orig.referenceType ?? undefined,
        referenceId: orig.referenceId ?? undefined,
        referenceNo: orig.referenceNo ?? undefined,
        clientId: orig.clientId ?? undefined,
        supplierId: orig.supplierId ?? undefined,
        groupId: orig.groupId ?? undefined,
        remarks: `Reversal of ${orig.txnNo}: ${reason}`,
        lines: orig.lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          stockStatus: l.stockStatus,
          direction: l.qtyIn.gt(0) ? 'OUT' : 'IN',
          qty: l.qtyIn.gt(0) ? l.qtyIn.toString() : l.qtyOut.toString(),
          unitCost: l.unitCost?.toString(),
          batchNo: l.batchNo,
          serialNo: l.serialNo,
          mfgDate: l.mfgDate ? fromDbDate(l.mfgDate) : null,
          expiryDate: l.expiryDate ? fromDbDate(l.expiryDate) : null,
        })),
      },
      { reversesTxnId: orig.id, skipActiveCheck: true },
    );
    return posted;
  };
  try {
    return await (opts.tx ? run(opts.tx) : prisma.$transaction(run));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw conflict('Transaction was already reversed');
    }
    throw e;
  }
}

/**
 * Recomputes every balance from the ledger and compares it with the cache. Mismatches are
 * reported, never auto-fixed or hidden.
 */
export async function reconcile(client: Tx | typeof prisma = prisma) {
  const rows = await client.$queryRaw<
    {
      item_id: string;
      warehouse_id: string;
      stock_status: StockStatus;
      ledger_qty: Dec | null;
      cached_qty: Dec | null;
    }[]
  >`
    WITH l AS (
      SELECT item_id, warehouse_id, stock_status, SUM(qty_in - qty_out) AS qty
      FROM inventory_transaction_items GROUP BY 1, 2, 3
    )
    SELECT COALESCE(l.item_id, b.item_id) AS item_id,
           COALESCE(l.warehouse_id, b.warehouse_id) AS warehouse_id,
           COALESCE(l.stock_status, b.stock_status) AS stock_status,
           l.qty AS ledger_qty, b.qty AS cached_qty
    FROM l FULL OUTER JOIN stock_balances b
      ON b.item_id = l.item_id AND b.warehouse_id = l.warehouse_id AND b.stock_status = l.stock_status`;
  const mismatches = rows
    .map((r) => ({
      itemId: r.item_id,
      warehouseId: r.warehouse_id,
      stockStatus: r.stock_status,
      ledger: new D(r.ledger_qty ?? 0),
      cached: new D(r.cached_qty ?? 0),
    }))
    .filter((r) => !r.ledger.eq(r.cached))
    .map((r) => ({
      itemId: r.itemId,
      warehouseId: r.warehouseId,
      stockStatus: r.stockStatus,
      ledgerQty: r.ledger.toFixed(3),
      cachedQty: r.cached.toFixed(3),
    }));
  return {
    checkedAt: new Date().toISOString(),
    balancesChecked: rows.length,
    ok: mismatches.length === 0,
    mismatches,
  };
}
