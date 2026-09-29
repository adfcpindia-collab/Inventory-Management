import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { PASSWORD, app, bearer, createUser, resetDb, tokenFor } from './helpers';

beforeEach(resetDb);

const login = (email: string, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ email, password });

describe('auth', () => {
  it('logs in, returns access token + httpOnly refresh cookie, never the hash', async () => {
    await createUser('ADMIN');
    const res = await login('admin@test.com');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/refresh_token=.*HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const me = await request(app).get('/api/auth/me').set(bearer(res.body.accessToken));
    expect(me.body.user.role).toBe('ADMIN');
  });

  it('rejects wrong password and unknown email identically, and audits the failure', async () => {
    await createUser('ADMIN');
    const bad = await login('admin@test.com', 'wrong-password');
    const unknown = await login('nobody@test.com');
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBe(2);
  });

  it('rejects inactive users at login and on existing tokens', async () => {
    const u = await createUser('STORE');
    const token = await tokenFor('STORE');
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    expect((await request(app).get('/api/auth/me').set(bearer(token))).status).toBe(401);
    expect((await login('store@test.com')).status).toBe(401);
  });

  it('requires a valid token', async () => {
    expect((await request(app).get('/api/items')).status).toBe(401);
    expect((await request(app).get('/api/items').set(bearer('garbage'))).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    await createUser('ADMIN');
    const first = await login('admin@test.com');
    const cookie1 = first.headers['set-cookie'] as unknown as string[];
    const r2 = await request(app).post('/api/auth/refresh').set('Cookie', cookie1);
    expect(r2.status).toBe(200);
    const cookie2 = r2.headers['set-cookie'] as unknown as string[];
    // replaying the old token is detected as theft
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie1)).status).toBe(401);
    // ...which also kills the newer one
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie2)).status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    await createUser('ADMIN');
    const r = await login('admin@test.com');
    const cookie = r.headers['set-cookie'] as unknown as string[];
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('rate limits login attempts', async () => {
    const limited = createApp({ loginRateLimitMax: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (await request(limited).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' }))
          .status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });
});

describe('users admin + RBAC', () => {
  it('only ADMIN can manage users; passwords are hashed and audited without the hash', async () => {
    const admin = await tokenFor('ADMIN');
    const manager = await tokenFor('MANAGER');
    const body = { email: 'New@Test.com', name: 'New', password: 'a-long-password', role: 'STORE' };
    expect((await request(app).post('/api/users').set(bearer(manager)).send(body)).status).toBe(
      403,
    );
    const res = await request(app).post('/api/users').set(bearer(admin)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('new@test.com');
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'new@test.com' } });
    expect(stored.passwordHash).not.toContain('a-long-password');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'User', action: 'CREATE' },
    });
    expect(JSON.stringify(audit.newValue)).not.toContain('passwordHash');
    expect((await login('new@test.com', 'a-long-password')).status).toBe(200);
  });

  it('rejects weak passwords and duplicate emails; admin cannot demote self', async () => {
    const admin = await tokenFor('ADMIN');
    const base = { email: 'x@test.com', name: 'X', role: 'STORE' };
    expect(
      (
        await request(app)
          .post('/api/users')
          .set(bearer(admin))
          .send({ ...base, password: 'short' })
      ).status,
    ).toBe(400);
    await request(app)
      .post('/api/users')
      .set(bearer(admin))
      .send({ ...base, password: 'long-enough-pw' });
    const dup = await request(app)
      .post('/api/users')
      .set(bearer(admin))
      .send({ ...base, email: 'X@test.com', password: 'long-enough-pw' });
    expect(dup.status).toBe(409);
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
    const demote = await request(app)
      .patch(`/api/users/${me.id}`)
      .set(bearer(admin))
      .send({ role: 'VIEWER' });
    expect(demote.status).toBe(400);
  });

  it('password reset revokes existing sessions', async () => {
    const admin = await tokenFor('ADMIN');
    const store = await createUser('STORE');
    const r = await login('store@test.com');
    const cookie = r.headers['set-cookie'] as unknown as string[];
    await request(app)
      .patch(`/api/users/${store.id}`)
      .set(bearer(admin))
      .send({ password: 'brand-new-password' });
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });
});
