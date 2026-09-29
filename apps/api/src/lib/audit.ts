import type { Tx } from './prisma';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

const toJson = (v: unknown) =>
  v === undefined || v === null ? undefined : JSON.parse(JSON.stringify(v));

/** Must be called with the same transaction client as the change it records. */
export async function writeAudit(tx: Tx, e: AuditEntry) {
  await tx.auditLog.create({
    data: {
      userId: e.userId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      oldValue: toJson(e.oldValue),
      newValue: toJson(e.newValue),
    },
  });
}
