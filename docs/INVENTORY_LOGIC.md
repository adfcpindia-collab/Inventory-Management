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

## Documents: procurement (GRN) and dispatch (challan)
`DRAFT → CONFIRMED → CANCELLED`. Only CONFIRMED affects stock. Drafts are editable and have no ledger
effect. Numbers (`grn_no`, `challan_no`) are unique case-insensitively (DB unique index on `lower()`)
and stay reserved after cancellation.

- **Confirm** row-locks the document, then calls `InventoryService.post(…, tx)` (PROCUREMENT in / DISPATCH
  out of USABLE stock) and flips the status in ONE DB transaction; the document stores `txn_id`. The ledger
  post uses idempotency key `<doc>-confirm:<id>`, and confirming an already-confirmed document returns it
  unchanged, so double-clicks and retries cannot double-post. If any line is short the whole document is
  rejected (409 with item codes and available/needed quantities) and nothing changes.
- **Cancel** (MANAGER/ADMIN): a draft just becomes CANCELLED; a confirmed document calls
  `InventoryService.reverse` in the same transaction, refused (409) if it would make stock negative
  (e.g. received goods already dispatched).
- **Validation:** items and parties must exist and be active (checked again at confirm); a line's unit is
  always the item's unit (a different `unitId` is rejected); qty > 0 with ≤ 3 decimals; amounts are computed
  server-side (`qty × rate × (1 + GST%)`, GST defaults to the item's rate).
- **Backdating:** confirming a document dated before today needs MANAGER/ADMIN; future dates are rejected.
- `Idempotency-Key` header on create returns the original document for a repeated request.
- `post()` reads and checks every stock bucket before writing any balance, so a caller that catches a
  shortage inside its own transaction never keeps partial updates.
- Printable challan: `/dispatch/:id/print` (browser print / Save as PDF).

## Conversions
A conversion has N inputs and M outputs (1→1 through N→M). `DRAFT → CONFIRMED → CANCELLED`; the ID
(`CONV-000001`) is generated from a DB sequence and is unique.

- **Confirm** runs in ONE DB transaction: `post(CONVERSION_OUT)` for the inputs (USABLE stock, checked as
  a whole — any short input rejects everything with item codes and quantities), then `post(CONVERSION_IN)`
  for the outputs. The two ledger headers share `group_id = conversion no.` and reference it. If anything
  fails (including the second post), the transaction rolls back: no stock moves, the document stays DRAFT.
- **Templates** (`conversion_templates` + inputs/outputs) store quantities for ONE run. A conversion built
  from a template stores `template_id` and `multiplier`; lines are scaled with exact decimal arithmetic and a
  result needing more than 3 decimals is rejected (never rounded). Explicit lines override the template, and
  fully custom conversions need no template. Inactive templates cannot start new conversions.
- **Rules:** items must be active and in their own unit; an item cannot be both an input and an output.
- **Reversal (cancel, MANAGER/ADMIN):** reverses the outputs first, then the inputs — both reversals in one
  transaction. If the outputs were already consumed, stock would go negative, so it is refused (409) and
  nothing changes.
- **Approval:** `settings.conversionApprovalThreshold` (ADMIN, Settings screen; blank = off). If total input
  quantity is above it, a STORE confirm only marks the draft `approval_status = PENDING` (HTTP 202, no stock
  effect). A MANAGER/ADMIN confirming it is the approval (`APPROVED`, approver recorded). Editing a draft
  resets the approval. Each step is audited (`REQUEST_APPROVAL`, `CONFIRM`).

## Returns, damage/scrap and adjustments
All four are ledger-backed documents (`DRAFT → CONFIRMED → CANCELLED`) sharing the document router:
create / edit draft / confirm / cancel (MANAGER/ADMIN), `Idempotency-Key`, backdating for MANAGER/ADMIN only.
Confirm posts through `InventoryService.post(…, tx)` in the same DB transaction as the status change;
cancel of a confirmed document reverses it and is refused (409) if that would make stock negative.

- **Customer return** (`/api/customer-returns`, `CUSTOMER_RETURN`, IN). Must reference a CONFIRMED challan;
  the client comes from the challan and the date cannot precede it. Each line has a condition:
  `GOOD → USABLE`, `DAMAGED → DAMAGED`, `NEEDS_INSPECTION → INSPECTION`, so damaged goods never become
  dispatchable automatically. Over-return rule: (this return + earlier CONFIRMED returns) ≤ dispatched, per
  item, and items must be on the challan. Checked on create/edit for early feedback and again on confirm
  with the challan row locked `FOR UPDATE`, so two concurrent returns cannot both pass.
- **Supplier return** (`/api/supplier-returns`, `SUPPLIER_RETURN`, OUT). Same linkage/rule against a CONFIRMED
  GRN. Each line leaves from `USABLE` or `DAMAGED` (return-to-supplier of damaged stock). Short stock → 409.
- A challan/GRN cannot be cancelled while confirmed returns reference it (cancel the returns first).
- **Damage / scrap / repair** (`/api/stock-actions`, numbers `DMG-######`, reason mandatory). `DAMAGE` =
  one `DAMAGE` txn (USABLE out, DAMAGED in). `SCRAP` = one `SCRAP` txn (DAMAGED out). `REPAIR` = DAMAGED →
  USABLE as an `ADJUSTMENT_OUT` + `ADJUSTMENT_IN` pair sharing `group_id = action no.` (there is no REPAIR
  type in the fixed enum). Cancelling a repair reverses the USABLE-in leg first.
- **Stock adjustment** (`/api/stock-adjustments`, `ADJ-######`). Stores a snapshot of the system qty, the
  physical count and the difference (zero difference is rejected). **Approval is always required:** a STORE
  "confirm" only sets `approval_status = PENDING` (HTTP 202, no ledger effect); a MANAGER/ADMIN confirm is the
  approval and posts `ADJUSTMENT_IN` (surplus) / `ADJUSTMENT_OUT` (shortfall). Under the balance row lock the
  system qty is re-read; if it differs from the snapshot the approval is refused (409, recount). Editing a
  draft re-snapshots and withdraws a pending request; a manager cancelling a pending draft is the rejection.
  A DB CHECK forbids a CONFIRMED adjustment without `APPROVED` + approver + txn.
- Audit actions: `CREATE`, `UPDATE`, `REQUEST_APPROVAL`, `CONFIRM`, `CANCEL` (+ the ledger `POST`/`REVERSE`).
