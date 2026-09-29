import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthUser, Role } from '@inventory/shared';
import { env } from '../lib/env';
import { forbidden, unauthorized } from '../lib/errors';
import { prisma } from '../lib/prisma';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signAccessToken(user: AuthUser) {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL,
  } as jwt.SignOptions);
}

/** Verifies the bearer token, then re-reads the user so deactivation/role changes apply at once. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let sub: string;
    try {
      const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
      });
      sub = String(payload.sub);
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user || !user.active) throw unauthorized('Account disabled');
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (e) {
    next(e);
  }
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
