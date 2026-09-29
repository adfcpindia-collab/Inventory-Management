import { Router } from 'express';
import { createUserSchema, idParam, listQuery, updateUserSchema } from '@inventory/shared';
import type { ListQuery } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { wrap } from '../../lib/async';
import { badRequest, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { hashPassword } from '../auth/auth.service';

const publicFields = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const usersRouter = Router();
usersRouter.use(authenticate, requireRole('ADMIN'));

usersRouter.get(
  '/',
  validate(listQuery, 'query'),
  wrap(async (req, res) => {
    const { q, page, pageSize, status } = req.query as unknown as ListQuery;
    const where = {
      ...(status === 'all' ? {} : { active: status === 'active' }),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { name: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: publicFields,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);
    res.json({ data, page, pageSize, total });
  }),
);

usersRouter.post(
  '/',
  validate(createUserSchema),
  wrap(async (req, res) => {
    const { password, ...rest } = req.body;
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { ...rest, passwordHash }, select: publicFields });
      await writeAudit(tx, {
        userId: req.user!.id,
        action: 'CREATE',
        entity: 'User',
        entityId: u.id,
        newValue: u,
      });
      return u;
    });
    res.status(201).json(user);
  }),
);

usersRouter.patch(
  '/:id',
  validate(idParam, 'params'),
  validate(updateUserSchema),
  wrap(async (req, res) => {
    const id = req.params.id as string;
    const { password, ...rest } = req.body as {
      password?: string;
      role?: string;
      active?: boolean;
      name?: string;
    };
    if (id === req.user!.id && (rest.active === false || (rest.role && rest.role !== 'ADMIN'))) {
      throw badRequest('You cannot deactivate or demote your own account');
    }
    const user = await prisma.$transaction(async (tx) => {
      const old = await tx.user.findUnique({ where: { id }, select: publicFields });
      if (!old) throw notFound('User not found');
      const data: Record<string, unknown> = { ...rest };
      if (password) data.passwordHash = await hashPassword(password);
      const u = await tx.user.update({ where: { id }, data, select: publicFields });
      if (password || rest.active === false) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await writeAudit(tx, {
        userId: req.user!.id,
        action: password ? 'UPDATE_PASSWORD' : 'UPDATE',
        entity: 'User',
        entityId: id,
        oldValue: old,
        newValue: u,
      });
      return u;
    });
    res.json(user);
  }),
);
