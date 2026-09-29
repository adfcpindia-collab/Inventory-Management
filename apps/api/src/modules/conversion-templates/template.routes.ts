import { Router } from 'express';
import { z } from 'zod';
import { conversionTemplateSchema, idParam, listQuery, type ListQuery } from '@inventory/shared';
import { wrap } from '../../lib/async';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as svc from './template.service';

const expandQuery = z.object({
  multiplier: z.coerce
    .number()
    .gt(0)
    .max(1_000_000)
    .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Max 3 decimal places')
    .default(1),
});

export const templateRouter = Router();
const writers = requireRole('ADMIN', 'MANAGER');
templateRouter.use(authenticate);

templateRouter.get(
  '/',
  validate(listQuery, 'query'),
  wrap(async (req, res) => res.json(await svc.list(req.query as unknown as ListQuery))),
);
templateRouter.get(
  '/:id',
  validate(idParam, 'params'),
  wrap(async (req, res) => res.json(await svc.get(req.params.id as string))),
);
templateRouter.get(
  '/:id/expand',
  validate(idParam, 'params'),
  validate(expandQuery, 'query'),
  wrap(async (req, res) =>
    res.json(
      await svc.expand(
        req.params.id as string,
        (req.query as unknown as { multiplier: number }).multiplier,
      ),
    ),
  ),
);
templateRouter.post(
  '/',
  writers,
  validate(conversionTemplateSchema),
  wrap(async (req, res) => res.status(201).json(await svc.create(req.body, req.user!.id))),
);
templateRouter.put(
  '/:id',
  writers,
  validate(idParam, 'params'),
  validate(conversionTemplateSchema),
  wrap(async (req, res) =>
    res.json(await svc.update(req.params.id as string, req.body, req.user!.id)),
  ),
);
templateRouter.delete(
  '/:id',
  writers,
  validate(idParam, 'params'),
  wrap(async (req, res) =>
    res.json(await svc.setActive(req.params.id as string, false, req.user!.id)),
  ),
);
templateRouter.post(
  '/:id/activate',
  writers,
  validate(idParam, 'params'),
  wrap(async (req, res) =>
    res.json(await svc.setActive(req.params.id as string, true, req.user!.id)),
  ),
);
