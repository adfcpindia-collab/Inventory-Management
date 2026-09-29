import { Router } from 'express';
import { z } from 'zod';
import { emptyToUndef, ledgerQuery, type LedgerQuery } from '@inventory/shared';
import { wrap } from '../../lib/async';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { listBalances, queryLedger } from './ledger.service';
import { reconcile } from './inventory.service';

const balanceQuery = z.object({
  itemId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  warehouseId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
});

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

inventoryRouter.get(
  '/ledger',
  validate(ledgerQuery, 'query'),
  wrap(async (req, res) => {
    res.json(await queryLedger(req.query as unknown as LedgerQuery));
  }),
);

inventoryRouter.get(
  '/balances',
  validate(balanceQuery, 'query'),
  wrap(async (req, res) => {
    res.json(await listBalances(req.query as { itemId?: string; warehouseId?: string }));
  }),
);

inventoryRouter.get(
  '/reconcile',
  requireRole('ADMIN', 'MANAGER'),
  wrap(async (_req, res) => {
    res.json(await reconcile());
  }),
);
