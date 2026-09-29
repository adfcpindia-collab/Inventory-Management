# Phase 9 — Testing, documentation, production build

- Fill test gaps against spec §32 (opening, procurement, dispatch, multi-item challan, conversions, returns, damage, adjustments, transfers, cancellation/reversal, negative-stock prevention, duplicate challans, daily closing, Excel export, reconciliation). Add Playwright end-to-end for the daily workflow: dashboard → procurement → multi-item dispatch → conversion → return/adjustment → daily report → Excel export.
- Seed script with clearly marked DEMO data: 5–10 products, 3 clients, 3 suppliers, opening stock, procurement, dispatch, conversion examples.
- Security pass: secrets, headers (helmet), CORS, rate limits, input validation, dependency audit.
- Docs: README, ARCHITECTURE, DATABASE, INVENTORY_LOGIC, DEPLOYMENT, USER_GUIDE (setup, migrations, env vars, seeding, calculations, backup/restore, exports, roles, deployment).
- Production Dockerfiles / compose, `npm run build` succeeds.

Final checklist: run full tests, lint, typecheck, build, fresh-DB migrate + seed, reconcile (zero mismatches), export verification. Report against spec §36 acceptance criteria item by item.
