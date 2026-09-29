# Phase 2 — Opening stock and the inventory ledger

Implement the core ledger engine. This is the most important module; be rigorous.

Build:
- Tables: inventory_transactions (header), inventory_transaction_items (lines: item, warehouse, stock_status, qty_in, qty_out, unit_cost, batch/serial nullable), stock_balances (cache).
- `InventoryService.post(txn)` — single entry point for all stock movement: runs in one DB transaction, locks balances, blocks negative stock, updates cache, writes audit log. No other code may touch balances.
- `InventoryService.reverse(txnId, reason)` — creates linked REVERSAL transaction.
- `reconcile()` — recomputes balances from ledger, compares with cache, returns mismatches; expose as API endpoint and CLI `inventory:reconcile`.
- Opening stock: manual entry + Excel import (upload → parse → validate → preview → show row errors → confirm → create OPENING_STOCK transactions). Never overwrite existing stock; reject duplicate opening for same item/warehouse unless explicitly adjusted. Downloadable template.
- Ledger view: Date, Type, Reference, Opening, In, Out, Balance, User, Remarks; filters by date range, item, type, client, supplier, challan, user.

Tests: post/reverse, negative-stock block, concurrent outward posts (race), reconcile detects a deliberately corrupted cache, import validation errors.
Stop and report.
