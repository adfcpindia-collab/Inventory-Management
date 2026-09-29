# Phase 1 — Foundation: auth, database, masters

Read CLAUDE.md and docs/SPEC.md. First inspect the repo and propose the monorepo layout, then scaffold it.

Build:
- Monorepo (apps/web, apps/api, packages/shared), TypeScript strict, ESLint, Prettier, Vitest, Docker Compose (Postgres), `.env.example`, `.gitignore`.
- Prisma schema + migrations for: users, roles, categories, units, items, clients, suppliers, warehouses (seed one default), audit_logs.
- Auth: password hashing (argon2/bcrypt), JWT or secure session cookies, refresh handling, RBAC middleware (ADMIN, MANAGER, STORE, VIEWER), rate limiting on login.
- Masters CRUD with soft-delete (active/inactive only): Item (all fields from spec §2, min/reorder/max, HSN, GST, tracking_type), Client, Supplier, Units (NOS, KG, LTR, MTR, SET, BOX, PCS), Categories.
- Searchable lists with pagination. Audit log on every change.
- Web: login, layout with responsive sidebar (per spec §25), master list/form screens.
- Shared Zod schemas used by both apps.

Verify: migrations from empty DB, auth + role tests, inactive items cannot be deleted, lint/typecheck/tests pass. Report and stop.
