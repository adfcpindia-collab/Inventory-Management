# Inventory logic

## Source of truth
`inventory_transactions` (header) + `inventory_transaction_items` (lines) are the ledger. They are
**append-only** — a DB trigger rejects UPDATE/DELETE. `stock_balances` is a cache keyed by
(item, warehouse, stock_status); it is written only by `InventoryService.post`, in the same DB
transaction as the ledger insert, and must always equal `SUM(qty_in - qty_out)` over the ledger.

## Posting (`modules/inventory/inventory.service.ts`)
`post(input, tx?)` is the single entry point for any stock movement (pass `tx` to join a caller's
transaction so a document status change and its movement commit/roll back together):
1. Idempotency: an existing `idempotency_key` returns the original transaction.
2. Validates lines: qty > 0, ≤ 3 decimals, items/warehouses exist and are active, date not in the future.
3. Nets lines per (item, warehouse, status) bucket, then for each bucket **in sorted order**
   (deadlock-free) upserts the balance row and `SELECT … FOR UPDATE`s it.
4. If any bucket would go below zero the whole post fails (409, `details.shortages`) — nothing is written.
   `stock_balances.qty >= 0` is also a DB CHECK.
5. Backdated posts (`txn_date` < today in `COMPANY_TIMEZONE`) additionally replay the bucket's daily
   ledger and refuse if any historical balance from that date on would go negative.
6. Inserts header + lines and an `audit_logs` row.

Only `USABLE` stock is available for outward movements; `DAMAGED` / `INSPECTION` are separate buckets.
Each line has exactly one direction (`qty_in` xor `qty_out`, DB CHECK). `unit_cost` is stored per line
for future valuation. Transfers / conversions are two headers (OUT + IN) sharing `group_id`.

## Reversal
`reverse(txnId, reason, userId)` appends a `REVERSAL` transaction with `reverses_txn_id` and every line
flipped. A transaction can be reversed once (unique index), a reversal cannot be reversed, and the
reversal is refused if it would make any balance negative. The original is never modified.
Over HTTP only `OPENING_STOCK` can be reversed directly; documents reverse via their own cancel flow.

## Reconciliation
`reconcile()` (API `GET /api/inventory/reconcile`, CLI `npm run inventory:reconcile`, exit code 1 on
mismatch) full-outer-joins ledger sums with the cache, so wrong, missing and phantom balance rows are
all reported. Mismatches are never auto-fixed.

## Opening stock
Manual or Excel. One OPENING_STOCK transaction per entry/import. An (item, warehouse) with a
non-reversed opening entry is rejected (never overwritten); concurrent attempts are serialised by an
advisory lock. Excel flow: `import/preview` (parses + validates, writes nothing) → `import/confirm`
(re-parses and re-validates the uploaded file; all-or-nothing; idempotent per file hash + date).
ADMIN/MANAGER only.

## Ledger view
`GET /api/inventory/ledger` — running balance per item computed over the item's history in the chosen
warehouse/bucket scope (default `USABLE`); display filters (dates, type, client, supplier, user,
reference) never change the balance/opening figures.
