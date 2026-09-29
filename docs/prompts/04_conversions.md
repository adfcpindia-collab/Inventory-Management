# Phase 4 — Conversion engine

Build conversions: inputs and outputs, all posting through InventoryService (CONVERSION_OUT for inputs, CONVERSION_IN for outputs) inside ONE DB transaction — all-or-nothing.

- Supports 1→1 (ABC 9 KG Empty Body → DCP 9 KG / Water 9 KG) and N→M (Empty Body + Valve + Hose → Finished Extinguisher).
- Templates/recipes (conversion_templates + inputs/outputs) and fully custom conversions. Template quantities scale by a multiplier.
- Unique conversion ID, status DRAFT/CONFIRMED/CANCELLED, block if any input lacks stock, optional manager approval above a configurable quantity threshold.
- Reversal of a conversion reverses all its lines together; block if outputs were already consumed and reversal would cause negative stock.
- UI: template picker, input/output line editor, live availability check.

Tests: 1→1, multi-input/multi-output, insufficient input, atomic rollback on failure, template scaling, reversal, ledger reconcile after each.
Stop and report.
