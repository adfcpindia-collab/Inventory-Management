import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AuthUser } from '@inventory/shared';
import { env } from '../../lib/env';
import { unauthorized } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { signAccessToken } from '../../middleware/auth';

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
// Compared against when the email is unknown so response time doesn't reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

export const hashPassword = (p: string) => bcrypt.hash(p, env.BCRYPT_ROUNDS);

const toAuthUser = (u: AuthUser & Record<string, unknown>): AuthUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});

async function issueRefreshToken(userId: string) {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) {
    await prisma.$transaction((tx) =>
      writeAudit(tx, { action: 'LOGIN_FAILED', entity: 'User', newValue: { email } }),
    );
    throw unauthorized('Invalid email or password');
  }
  const authUser = toAuthUser(user);
  const refresh = await issueRefreshToken(user.id);
  await prisma.$transaction((tx) =>
    writeAudit(tx, { userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id }),
  );
  return { user: authUser, accessToken: signAccessToken(authUser), refresh };
}

/** Rotates the refresh token. Presenting an already-revoked token revokes the whole family. */
export async function refresh(token: string) {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row) throw unauthorized('Invalid session');
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized('Session revoked');
  }
  if (row.expiresAt < new Date() || !row.user.active) throw unauthorized('Session expired');
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  const authUser = toAuthUser(row.user);
  return {
    user: authUser,
    accessToken: signAccessToken(authUser),
    refresh: await issueRefreshToken(row.userId),
  };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
