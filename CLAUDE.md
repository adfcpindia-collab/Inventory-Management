# Inventory Management System — Project Rules

Ledger-based inventory web app. Read this file fully before every task. Full original spec: `docs/SPEC.md` (copy the source PDF text there).

## Non-negotiable architecture rules
1. **Source of truth = CONFIRMED inventory transactions.** Never overwrite stock quantities. Cached balances (`stock_balances`) are updated only inside the same DB transaction that confirms a ledger entry, and must always reconcile to the ledger.
2. Only `CONFIRMED` documents affect stock. Statuses: `DRAFT`, `CONFIRMED`, `CANCELLED`. Confirmed records are never deleted or edited; corrections/cancellations create **reversal transactions** linked to the original.
3. Negative stock is prohibited by default (enforced in service layer AND with a DB check/lock). Use row-level locking (`SELECT ... FOR UPDATE`) on balances when confirming outward movements.
4. Quantities are stored as `NUMERIC(18,3)`, never floats. Money as `NUMERIC(18,2)`. Reject zero/negative quantities.
5. Every important action writes an `audit_logs` row (user, action, entity, old value, new value, timestamp) in the same DB transaction.
6. Idempotency: unique constraints on challan no., GRN no., conversion ID (per company); client-supplied idempotency key on create/confirm endpoints.
7. Validate in frontend (Zod) and backend (same Zod schemas shared from `packages/shared`) and enforce with DB constraints.
8. Design for multi-warehouse from day one: every ledger line has `warehouse_id` (one default warehouse initially). Transfers = `TRANSFER_OUT` + `TRANSFER_IN` sharing a transfer ID.
9. Batch/serial tracking is optional per item (`tracking_type: NONE | BATCH | SERIAL`). Never force it.

## Decisions made for gaps in the spec (change only with user approval)
- **Damaged/scrap stock** is a separate `stock_status` bucket (`USABLE`, `DAMAGED`, `INSPECTION`) on ledger lines and balances. Only `USABLE` counts as available for dispatch/conversion. Dashboard "total stock" shows USABLE; damaged shown separately.
- **Costing:** v1 stores rates on documents only; no valuation method. Keep a `unit_cost` column on ledger lines so FIFO/weighted-average can be added later.
- **Daily boundary:** business date is the `txn_date` (DATE) chosen on the document, not the created timestamp. Company timezone setting default `Asia/Kolkata`. Backdated confirms are allowed for MANAGER/ADMIN only, audited, and trigger recalculation checks.
- **Roles:** ADMIN (all, backup/restore, users), MANAGER (approve, cancel, backdate), STORE (create/confirm daily transactions), VIEWER (read-only + exports).
- **Daily report:** Closing = Opening + Total In − Total Out, computed from ledger only, and compared with cached balances; mismatches are flagged, never hidden.
- **Transaction types (enum):** OPENING_STOCK, PROCUREMENT, DISPATCH, CUSTOMER_RETURN, SUPPLIER_RETURN, CONVERSION_IN, CONVERSION_OUT, ADJUSTMENT_IN, ADJUSTMENT_OUT, DAMAGE, SCRAP, TRANSFER_IN, TRANSFER_OUT, REVERSAL (with `reverses_txn_id`).

## Stack
React + TypeScript + Vite + Tailwind; Node + TypeScript + Express (or NestJS); PostgreSQL + Prisma; ExcelJS; PDF via pdfkit or Puppeteer; Recharts; Zod; Vitest + Playwright; Docker Compose. Monorepo: `apps/web`, `apps/api`, `packages/shared`.

## Working method
- Before coding a phase: inspect repo, state plan (schema changes, endpoints, routes, validation), then implement incrementally.
- Small files, one module per folder (routes → controller → service → repository). No giant files.
- After each module: run tests, lint, typecheck; run the reconciliation function; fix before moving on.
- Write tests alongside code (not at the end). Inventory-critical paths need tests before the phase is "done".
- Never hardcode secrets; use `.env` + `.env.example`. Maintain `.gitignore`.
- Seed data must be clearly labelled `DEMO`.
- Update docs (`README`, `ARCHITECTURE`, `DATABASE`, `INVENTORY_LOGIC`, `DEPLOYMENT`, `USER_GUIDE`) as each phase completes.
- Stop at the end of each phase and report: what was built, tests run, known gaps. Wait for approval before the next phase.

## Commands (fill in as scaffolded)
- `docker compose up -d` — Postgres
- `npm run dev`, `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`
- `npm run db:migrate`, `npm run db:seed`, `npm run inventory:reconcile`

## Definition of done (final)
Local setup works; migrations work; auth works; all modules work; conversions reconcile; negative stock blocked; cancel/reversal works; audit logs work; daily report reconciles to ledger; Excel/PDF export works; tests, lint, typecheck, production build pass; docs complete.
