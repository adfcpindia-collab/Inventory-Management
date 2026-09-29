# Inventory Management System

Ledger-based inventory web app. Rules: [CLAUDE.md](CLAUDE.md). Spec: [docs/SPEC.md](docs/SPEC.md). Phase prompts: `docs/prompts/`.

**Status:** Phases 1–4 complete (auth + masters; ledger engine + opening stock; procurement + dispatch; conversions). See [docs/INVENTORY_LOGIC.md](docs/INVENTORY_LOGIC.md).

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

## Try it from a browser only (tablet / no local setup): GitHub Codespaces
1. On GitHub open this repo, switch to the branch, then **Code → Codespaces → Create codespace**.
2. Wait for setup to finish (first run takes a few minutes: it starts Postgres, installs, migrates, seeds).
3. Open the **Ports** tab, find port **5173** ("Inventory app"), and open its forwarded address.
4. Sign in with `admin@example.com` / `CHANGE-ME-strong-password`.

If the app isn't running, open a terminal and run `npm run dev`.

## Try it from a tablet on the same Wi‑Fi as your computer
Run the normal setup on the computer, then open `http://<computer-ip>:5173` on the tablet
(the dev server listens on all interfaces).
