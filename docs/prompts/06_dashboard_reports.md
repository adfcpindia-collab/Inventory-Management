# Phase 6 — Dashboard and reports

- Dashboard: total items, total usable stock, low-stock, out-of-stock, today's procurement/dispatch/conversions/returns/adjustments counts, item table (item, category, available, unit, min level, status), warnings (low stock, pending approvals, reconciliation mismatch).
- Daily Inventory Report per item for a chosen date: Opening, Procurement, Customer Returns, Conversion In, Adjustment In, Total In, Dispatch, Supplier Returns, Conversion Out, Damage/Scrap, Adjustment Out, Total Out, Closing. Computed from the ledger only; include transfer in/out per warehouse; add a reconciliation status column.
- Reports: challan-wise, client-wise, item-wise, date-range; quick ranges (Today, Yesterday, This Week, This Month, Custom); global search by challan, client, supplier, item, transaction ID, conversion ID, GRN, remarks.

Required test: encode spec §37 example (ABC 9 KG: 50 + 20 − 10 = 60; DCP 9 KG: 30 + 10 − 5 = 35; ABC Empty Body: 20 − 10 = 10) and assert exact figures from confirmed transactions.
Stop and report.
