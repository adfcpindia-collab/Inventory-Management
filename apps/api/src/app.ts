import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './lib/env';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth/auth.routes';
import { dispatchRouter } from './modules/dispatch/dispatch.routes';
import { procurementRouter } from './modules/procurement/procurement.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { openingRouter } from './modules/opening-stock/opening.routes';
import { mastersRouter } from './modules/masters/masters.routes';
import { usersRouter } from './modules/users/users.routes';

export interface AppOptions {
  loginRateLimitMax?: number;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', authRouter(opts.loginRateLimitMax));
  app.use('/api/users', usersRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/opening-stock', openingRouter);
  app.use('/api/procurements', procurementRouter);
  app.use('/api/dispatches', dispatchRouter);
  app.get('/api/company', authenticate, (_req, res) => {
    res.json({ name: env.COMPANY_NAME, timezone: env.COMPANY_TIMEZONE });
  });
  app.use('/api', mastersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
