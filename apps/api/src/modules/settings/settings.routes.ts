import { Router } from 'express';
import { settingsSchema } from '@inventory/shared';
import { wrap } from '../../lib/async';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { getSettings, updateSettings } from './settings.service';

export const settingsRouter = Router();
settingsRouter.use(authenticate);
settingsRouter.get(
  '/',
  wrap(async (_req, res) => res.json(await getSettings())),
);
settingsRouter.put(
  '/',
  requireRole('ADMIN'),
  validate(settingsSchema),
  wrap(async (req, res) => res.json(await updateSettings(req.body, req.user!.id))),
);
