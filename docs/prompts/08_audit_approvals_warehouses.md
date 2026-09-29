# Phase 8 — Audit, approvals, warehouses, backup

- Audit log viewer with filters (user, action, entity, date) and old/new value diff. Confirm every module writes logs.
- Approval workflow (configurable in Settings) for adjustments, large conversions, cancellations. Pending approvals surfaced on dashboard.
- Warehouses: management UI, warehouse-specific balances, filters everywhere, transfers via TRANSFER_OUT + TRANSFER_IN sharing a transfer ID; total company stock must stay unchanged (test it).
- Batch/serial: optional capture on lines for items with tracking enabled; batch expiry warnings.
- Backup: ADMIN-only pg_dump backup endpoint/CLI, timestamped files outside web root, documented restore steps, restore never exposed as a one-click UI action.
- Notification architecture: event emitter/interface for future email/SMS; no providers implemented.

Tests: role permissions matrix, transfer invariants, approval gating, audit completeness. Stop and report.
