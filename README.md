# Inventory Management System

Ledger-based inventory web app. Rules: [CLAUDE.md](CLAUDE.md). Spec: [docs/SPEC.md](docs/SPEC.md). Phase prompts: `docs/prompts/`.

**Status:** Phases 1–3 complete (auth + masters; ledger engine + opening stock; procurement + dispatch). See [docs/INVENTORY_LOGIC.md](docs/INVENTORY_LOGIC.md).

## Layout

- `apps/api` — Express + Prisma + PostgreSQL
- `apps/web` — React + Vite + Tailwind
- `packages/shared` — Zod schemas used by both apps (consumed as TypeScript source)

## Setup

```bash
cp .env.example apps/api/.env   # then edit the CHANGE-ME secrets
docker compose up -d            # Postgres (or point DATABASE_URL at your own)
npm install
npm run db:migrate              # prisma migrate deploy
npm run db:seed                 # units, categories, default warehouse, first ADMIN from SEED_ADMIN_*
npm run dev                     # api :4000, web :5173 (proxies /api)
```

## Commands

`npm run test | lint | typecheck | build`; new migrations: `npm run db:migrate:dev -w @inventory/api`.
API tests need Postgres; they rebuild `inventory_test` from empty by replaying all migrations
(override with `TEST_DATABASE_URL`; the database name must end in `_test`).

## Auth & roles

Access JWT (15 min, kept in memory) + rotating refresh token (httpOnly, SameSite=Strict cookie, stored hashed;
reuse of a rotated token revokes the session family). Login is rate limited.
ADMIN (all, users) · MANAGER (write masters) · STORE / VIEWER (read).

## Masters

Items, Clients, Suppliers, Categories, Units under `/api/*`. `DELETE` only deactivates; deleting an
inactive record returns 409; `POST /:id/activate` restores. Every write is audited in the same transaction.

## Inventory
`npm run inventory:reconcile` recomputes balances from the ledger and exits non-zero on any mismatch.
