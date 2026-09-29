# Phase 3 — Procurement (GRN) and Dispatch (challan)

Build on InventoryService only.

Procurement: header (date, supplier, GRN no. unique, remarks) + multiple item lines (item, qty, unit, rate, GST, amount, batch). DRAFT → CONFIRMED creates PROCUREMENT transaction. CANCEL creates reversal (blocked if it would make stock negative).

Dispatch: header (date, challan no. unique, client, address, vehicle, driver, sales order, remarks) + multiple item lines (qty, optional rate). Confirm creates DISPATCH transaction, checks USABLE stock per warehouse, prevents negative stock. Cancel → reversal.

Also: idempotency keys, duplicate challan/GRN rejection, inactive-item rejection, unit validation, printable challan view (HTML/PDF), searchable lists with status filters, UI forms with line-item editor and stock-availability hints.

Tests: multi-item challan, insufficient stock on one line rejects the whole challan, duplicate challan, double-submit idempotency, cancellation/reversal, inactive item.
Stop and report.
