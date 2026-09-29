import { Prisma } from '@prisma/client';
import type { LedgerQuery, LedgerRow } from '@inventory/shared';
import { fromDbDate, toDbDate } from '../../lib/dates';
import { prisma } from '../../lib/prisma';

interface Raw {
  line_id: string;
  txn_id: string;
  txn_no: string;
  txn_date: Date;
  type: LedgerRow['type'];
  reference_no: string | null;
  item_id: string;
  warehouse_id: string;
  stock_status: LedgerRow['stockStatus'];
  qty_in: Prisma.Decimal;
  qty_out: Prisma.Decimal;
  balance: Prisma.Decimal;
  user_name: string;
  remarks: string | null;
  total: bigint;
}

const f3 = (d: Prisma.Decimal) => new Prisma.Decimal(d).toFixed(3);

/**
 * Ledger lines with a running balance per item. The balance is computed over the item's full history
 * in the selected warehouse/bucket scope, so it stays correct regardless of the display filters
 * (date range, type, client, ...). Opening = balance before the line.
 */
export async function queryLedger(q: LedgerQuery) {
  const S = Prisma.sql;
  const scope: Prisma.Sql[] = [];
  if (q.itemId) scope.push(S`l.item_id = ${q.itemId}::uuid`);
  if (q.warehouseId) scope.push(S`l.warehouse_id = ${q.warehouseId}::uuid`);
  if (q.stockStatus !== 'ALL') scope.push(S`l.stock_status = ${q.stockStatus}::"StockStatus"`);

  const show: Prisma.Sql[] = [];
  if (q.from) show.push(S`b.txn_date >= ${toDbDate(q.from)}::date`);
  if (q.to) show.push(S`b.txn_date <= ${toDbDate(q.to)}::date`);
  if (q.type) show.push(S`b.type = ${q.type}::"TxnType"`);
  if (q.clientId) show.push(S`b.client_id = ${q.clientId}::uuid`);
  if (q.supplierId) show.push(S`b.supplier_id = ${q.supplierId}::uuid`);
  if (q.userId) show.push(S`b.created_by_id = ${q.userId}::uuid`);
  if (q.reference) {
    const like = `%${q.reference.replace(/[\\%_]/g, '\\$&')}%`;
    show.push(S`(b.reference_no ILIKE ${like} OR b.txn_no ILIKE ${like})`);
  }
  const where = (parts: Prisma.Sql[]) =>
    parts.length ? S`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Raw[]>(S`
    WITH b AS (
      SELECT l.id AS line_id, t.id AS txn_id, t.txn_no, t.txn_date, t.type, t.reference_no,
             t.client_id, t.supplier_id, t.created_by_id, t.remarks, t.created_at, l.line_no,
             l.item_id, l.warehouse_id, l.stock_status, l.qty_in, l.qty_out,
             SUM(l.qty_in - l.qty_out) OVER (
               PARTITION BY l.item_id ORDER BY t.txn_date, t.created_at, t.txn_no, l.line_no
             ) AS balance
      FROM inventory_transaction_items l
      JOIN inventory_transactions t ON t.id = l.txn_id
      ${where(scope)}
    )
    SELECT b.line_id, b.txn_id, b.txn_no, b.txn_date, b.type, b.reference_no, b.item_id,
           b.warehouse_id, b.stock_status, b.qty_in, b.qty_out, b.balance, b.remarks,
           u.name AS user_name, COUNT(*) OVER () AS total
    FROM b JOIN users u ON u.id = b.created_by_id
    ${where(show)}
    ORDER BY b.item_id, b.txn_date, b.created_at, b.txn_no, b.line_no
    LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);

  const data: LedgerRow[] = rows.map((r) => ({
    lineId: r.line_id,
    txnId: r.txn_id,
    txnNo: r.txn_no,
    date: fromDbDate(r.txn_date),
    type: r.type,
    reference: r.reference_no ?? r.txn_no,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    stockStatus: r.stock_status,
    opening: f3(new Prisma.Decimal(r.balance).minus(r.qty_in).plus(r.qty_out)),
    in: f3(r.qty_in),
    out: f3(r.qty_out),
    balance: f3(r.balance),
    user: r.user_name,
    remarks: r.remarks,
  }));
  return { data, page: q.page, pageSize: q.pageSize, total: Number(rows[0]?.total ?? 0) };
}

export async function listBalances(filter: { itemId?: string; warehouseId?: string }) {
  return prisma.stockBalance.findMany({
    where: { itemId: filter.itemId, warehouseId: filter.warehouseId, qty: { gt: 0 } },
    include: { item: { select: { code: true, name: true, unit: { select: { code: true } } } } },
    orderBy: [{ item: { code: 'asc' } }, { stockStatus: 'asc' }],
    take: 1000,
  });
}
