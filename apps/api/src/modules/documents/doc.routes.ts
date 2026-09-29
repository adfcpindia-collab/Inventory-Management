import { Router } from 'express';
import type { ZodTypeAny } from 'zod';
import {
  docListQuery,
  idParam,
  reverseSchema,
  type DocListQuery,
  type Role,
} from '@inventory/shared';
import { wrap } from '../../lib/async';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idemKey } from './common';

interface DocService {
  create(input: never, userId: string, key?: string): Promise<unknown>;
  update(id: string, input: never, userId: string): Promise<unknown>;
  confirm(id: string, userId: string, role: Role): Promise<unknown>;
  cancel(id: string, reason: string, userId: string): Promise<unknown>;
  get(id: string): Promise<unknown>;
  list(q: DocListQuery): Promise<unknown>;
  serialize(d: never): unknown;
}

/**
 * Shared HTTP surface for ledger-backed documents:
 *   GET / · GET /:id · POST / · PUT /:id (draft) · POST /:id/confirm · POST /:id/cancel
 * STORE can create/edit/confirm; cancelling a document needs MANAGER or ADMIN.
 */
export function documentRouter(svc: DocService, schema: ZodTypeAny) {
  const router = Router();
  const writers = requireRole('ADMIN', 'MANAGER', 'STORE');
  const s = (d: unknown) => svc.serialize(d as never);
  router.use(authenticate);

  router.get(
    '/',
    validate(docListQuery, 'query'),
    wrap(async (req, res) => {
      res.json(await svc.list(req.query as unknown as DocListQuery));
    }),
  );
  router.get(
    '/:id',
    validate(idParam, 'params'),
    wrap(async (req, res) => {
      res.json(s(await svc.get(req.params.id as string)));
    }),
  );
  router.post(
    '/',
    writers,
    validate(schema),
    wrap(async (req, res) => {
      res
        .status(201)
        .json(
          s(
            await svc.create(
              req.body as never,
              req.user!.id,
              idemKey(req.headers['idempotency-key']),
            ),
          ),
        );
    }),
  );
  router.put(
    '/:id',
    writers,
    validate(idParam, 'params'),
    validate(schema),
    wrap(async (req, res) => {
      res.json(s(await svc.update(req.params.id as string, req.body as never, req.user!.id)));
    }),
  );
  router.post(
    '/:id/confirm',
    writers,
    validate(idParam, 'params'),
    wrap(async (req, res) => {
      const doc = (await svc.confirm(req.params.id as string, req.user!.id, req.user!.role)) as {
        status: string;
        approvalStatus?: string;
      };
      // 202: not confirmed yet — the draft is now waiting for a manager's approval.
      const pending = doc.status === 'DRAFT' && doc.approvalStatus === 'PENDING';
      res.status(pending ? 202 : 200).json(s(doc));
    }),
  );
  router.post(
    '/:id/cancel',
    requireRole('ADMIN', 'MANAGER'),
    validate(idParam, 'params'),
    validate(reverseSchema),
    wrap(async (req, res) => {
      res.json(s(await svc.cancel(req.params.id as string, req.body.reason, req.user!.id)));
    }),
  );
  return router;
}
