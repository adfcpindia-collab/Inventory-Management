import { Router } from 'express';
import type { ZodTypeAny } from 'zod';
import { idParam, listQuery } from '@inventory/shared';
import type { ListQuery } from '@inventory/shared';
import { writeAudit } from './audit';
import { wrap } from './async';
import { conflict, notFound } from './errors';
import { prisma, type Tx } from './prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';

/** The subset of a Prisma model delegate this factory relies on. */
interface Delegate {
  findMany(args: object): Promise<Record<string, unknown>[]>;
  findUnique(args: object): Promise<Record<string, unknown> | null>;
  count(args: object): Promise<number>;
  create(args: object): Promise<Record<string, unknown>>;
  update(args: object): Promise<Record<string, unknown>>;
}

export interface MasterConfig {
  entity: string;
  delegate: (tx: Tx) => Delegate;
  schema: ZodTypeAny;
  searchFields: string[];
  orderBy: object;
  include?: object;
  /** Cross-record validation run inside the write transaction. */
  beforeWrite?: (tx: Tx, data: Record<string, unknown>) => Promise<void>;
}

const WRITE_ROLES = ['ADMIN', 'MANAGER'] as const;

/**
 * CRUD router for a master with soft-delete only: DELETE deactivates, POST /:id/activate restores.
 * Every write records an audit row in the same transaction.
 */
export function masterRouter(cfg: MasterConfig) {
  const router = Router();
  const db = (tx: Tx) => cfg.delegate(tx);
  const read = { include: cfg.include };
  router.use(authenticate);

  router.get(
    '/',
    validate(listQuery, 'query'),
    wrap(async (req, res) => {
      const { q, page, pageSize, status } = req.query as unknown as ListQuery;
      const where = {
        ...(status === 'all' ? {} : { active: status === 'active' }),
        ...(q
          ? {
              OR: cfg.searchFields.map((f) => ({
                [f]: { contains: q, mode: 'insensitive' },
              })),
            }
          : {}),
      };
      const [data, total] = await Promise.all([
        db(prisma).findMany({
          where,
          ...read,
          orderBy: cfg.orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db(prisma).count({ where }),
      ]);
      res.json({ data, page, pageSize, total });
    }),
  );

  router.get(
    '/:id',
    validate(idParam, 'params'),
    wrap(async (req, res) => {
      const row = await db(prisma).findUnique({ where: { id: req.params.id }, ...read });
      if (!row) throw notFound(`${cfg.entity} not found`);
      res.json(row);
    }),
  );

  router.post(
    '/',
    requireRole(...WRITE_ROLES),
    validate(cfg.schema),
    wrap(async (req, res) => {
      const row = await prisma.$transaction(async (tx) => {
        await cfg.beforeWrite?.(tx, req.body);
        const created = await db(tx).create({ data: req.body, ...read });
        await writeAudit(tx, {
          userId: req.user!.id,
          action: 'CREATE',
          entity: cfg.entity,
          entityId: String(created.id),
          newValue: created,
        });
        return created;
      });
      res.status(201).json(row);
    }),
  );

  router.put(
    '/:id',
    requireRole(...WRITE_ROLES),
    validate(idParam, 'params'),
    validate(cfg.schema),
    wrap(async (req, res) => {
      const id = req.params.id as string;
      const row = await prisma.$transaction(async (tx) => {
        const old = await db(tx).findUnique({ where: { id }, ...read });
        if (!old) throw notFound(`${cfg.entity} not found`);
        await cfg.beforeWrite?.(tx, req.body);
        const updated = await db(tx).update({ where: { id }, data: req.body, ...read });
        await writeAudit(tx, {
          userId: req.user!.id,
          action: 'UPDATE',
          entity: cfg.entity,
          entityId: id,
          oldValue: old,
          newValue: updated,
        });
        return updated;
      });
      res.json(row);
    }),
  );

  const setActive = (active: boolean) =>
    wrap(async (req, res) => {
      const id = req.params.id as string;
      const row = await prisma.$transaction(async (tx) => {
        const old = await db(tx).findUnique({ where: { id }, ...read });
        if (!old) throw notFound(`${cfg.entity} not found`);
        if (old.active === active) {
          throw conflict(`${cfg.entity} is already ${active ? 'active' : 'inactive'}`);
        }
        const updated = await db(tx).update({ where: { id }, data: { active }, ...read });
        await writeAudit(tx, {
          userId: req.user!.id,
          action: active ? 'ACTIVATE' : 'DEACTIVATE',
          entity: cfg.entity,
          entityId: id,
          oldValue: { active: old.active },
          newValue: { active },
        });
        return updated;
      });
      res.json(row);
    });

  // Records are never physically deleted; "delete" only deactivates. Deleting an
  // already-inactive record is rejected with 409.
  router.delete('/:id', requireRole(...WRITE_ROLES), validate(idParam, 'params'), setActive(false));
  router.post(
    '/:id/activate',
    requireRole(...WRITE_ROLES),
    validate(idParam, 'params'),
    setActive(true),
  );
  return router;
}
