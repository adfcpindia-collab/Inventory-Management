import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema } from '@inventory/shared';
import { env, isProd } from '../../lib/env';
import { wrap } from '../../lib/async';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as service from './auth.service';

const COOKIE = 'refresh_token';
const cookieOpts = (expires?: Date) => ({
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/api/auth',
  ...(expires ? { expires } : {}),
});

function respond(res: Response, r: Awaited<ReturnType<typeof service.login>>) {
  res.cookie(COOKIE, r.refresh.token, cookieOpts(r.refresh.expiresAt));
  res.json({ user: r.user, accessToken: r.accessToken });
}

export function authRouter(loginRateLimitMax = env.LOGIN_RATE_LIMIT_MAX) {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: loginRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try later' } },
  });

  router.post(
    '/login',
    loginLimiter,
    validate(loginSchema),
    wrap(async (req, res) => respond(res, await service.login(req.body.email, req.body.password))),
  );
  router.post(
    '/refresh',
    wrap(async (req, res) => {
      const token = req.cookies?.[COOKIE];
      if (!token)
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session' } });
      respond(res, await service.refresh(token));
    }),
  );
  router.post(
    '/logout',
    wrap(async (req, res) => {
      await service.logout(req.cookies?.[COOKIE]);
      res.clearCookie(COOKIE, cookieOpts());
      res.status(204).end();
    }),
  );
  router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user });
  });
  return router;
}
