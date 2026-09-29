# Handoff — where the project stands

Read `CLAUDE.md` first (rules), then this file. Phase prompts are in `docs/prompts/`; the source spec is `docs/SPEC.md`.

## Status
Phases 1–4 are **done, tested and approved**: auth/RBAC/masters, ledger engine + opening stock,
procurement + dispatch, conversions (templates, scaling, atomic confirm, reversal, optional approval).
**Next: Phase 5** — `docs/prompts/05_returns_damage_adjustments.md`. Stop and report at the end of each
phase and wait for approval (see CLAUDE.md "Working method").

Branch: `claude/new-session-je4w1m`. 100 API tests pass; lint, typecheck and build are clean.

## Run it
```bash
cp .env.example apps/api/.env
docker compose up -d && npm install
npm run db:generate -w @inventory/api && npm run db:migrate && npm run db:seed
npm run dev            # API :4000, web :5173 (Vite proxies /api). Login: SEED_ADMIN_* from .env
npm test               # needs Postgres; rebuilds the `inventory_test` DB from scratch (see below)
npm run inventory:reconcile
```

## How the code is organised (apps/api/src)
- `modules/inventory/inventory.service.ts` — **the only code allowed to change stock**: `post(input, tx?)`,
  `reverse(txnId, reason, userId, {tx})`, `reconcile()`. Pass `tx` to join the caller's DB transaction so a
  document status change and its ledger movement commit or roll back together.
- `modules/documents/` — `common.ts` (item/unit validation, backdate rule, `explainShortage`,
  `mapDuplicate`) and `doc.routes.ts` (shared create/edit/confirm/cancel HTTP surface; confirm returns 202
  when a draft is parked for approval). Procurement, dispatch and conversions all use it.
- `lib/master.ts` — generic soft-delete master CRUD (items, clients, suppliers, categories, units).
- Shared Zod schemas live in `packages/shared/src` and are used by both API and web.
- Web: `apps/web/src/components/DocPages.tsx` (list/editor/detail for GRN + challan),
  `pages/Conversions.tsx`, `MasterPage.tsx`, etc.

## Decisions and conventions worth keeping
- A ledger **transaction header has ONE type**, so transfers and conversions are **two headers** (OUT + IN)
  sharing `group_id` (conversion no. / future transfer id). Reverse each header (`reverse()`), inputs/outputs
  in the right order, inside one transaction.
- Ledger rows are append-only (DB trigger). Corrections are `REVERSAL` rows. Over HTTP only OPENING_STOCK
  can be reversed directly; documents reverse through their own cancel flow.
- `post()` reads/locks/checks every stock bucket **before** writing any balance; shortages return 409 with
  `details.shortages` (documents enrich this with item codes via `explainShortage`).
- Idempotency: `Idempotency-Key` header on create; confirm posts use keys like `dispatch-confirm:<id>`;
  confirming an already-confirmed document returns it unchanged.
- Document numbers are unique case-insensitively (raw `lower()` unique indexes in the migrations).
- Only `USABLE` stock is available for dispatch/conversion; `DAMAGED` and `INSPECTION` are separate buckets
  (the schema already has `StockStatus` — Phase 5 uses it).
- Backdated confirms need MANAGER/ADMIN and are rejected if any earlier date's balance would go negative.
- Settings live in the `settings` key/value table (`conversionApprovalThreshold` so far); Phase 8
  generalises approvals for adjustments and cancellations.
- Prisma `Decimal` JSON-serialises as a string without trailing zeros (`"21"` not `"21.00"`); the UI formats.

## Practical gotchas
- **Migrations:** use `npx prisma migrate dev --create-only --name x`, then edit the SQL (add sequences
  *before* tables that default to them, plus CHECK constraints / triggers), then `npx prisma migrate deploy`
  and `npx prisma generate`. Prisma refuses `migrate reset` when run by an AI agent (needs the user's
  explicit consent) — do not work around it. Tests reset by dropping the schema of a DB whose name ends in
  `_test` (`apps/api/test/global-setup.ts`) and running `migrate deploy`.
- Tests need Postgres reachable at `TEST_DATABASE_URL` (default `postgresql://inv:inv@localhost:5432/inventory_test`,
  create the database once). Test files run sequentially; `test/helpers.ts` `resetDb()` truncates tables —
  **add new tables there**.
- Test fixtures: `seedWorld(n)` (category, unit, default warehouse, n items), `tokenFor(role)`, `isoDate(offset)`.
- Don't use `pkill -f` / process-scanning kill loops in the shell: they match the shell's own command line.
  Track PIDs in files instead.
- Run inside GitHub Codespaces via `.devcontainer/` (untested by the author); or locally with Docker.

## Known gaps / not built yet
- Users screen, Audit Logs screen, Dashboard, Reports, exports, warehouses UI (all later phases).
- No sidebar entry for conversion Templates (linked from the Conversions page).
- Procurement has no print view (challan does). Batch/serial: batch numbers stored on lines, no batch balances yet.
- Approval threshold compares total input quantity across units (simple by design).
