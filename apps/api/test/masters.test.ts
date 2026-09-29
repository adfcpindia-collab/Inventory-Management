import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/lib/prisma';
import { app, bearer, itemPayload, resetDb, seedRefData, tokenFor } from './helpers';

beforeEach(resetDb);

describe('role matrix on masters', () => {
  it.each([
    ['ADMIN', 201],
    ['MANAGER', 201],
    ['STORE', 403],
    ['VIEWER', 403],
  ] as const)('%s creating a client -> %i', async (role, status) => {
    const t = await tokenFor(role);
    const res = await request(app)
      .post('/api/clients')
      .set(bearer(t))
      .send({ companyName: 'Acme' });
    expect(res.status).toBe(status);
  });

  it('every role can read', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'STORE', 'VIEWER'] as const) {
      const res = await request(app)
        .get('/api/clients')
        .set(bearer(await tokenFor(role)));
      expect(res.status).toBe(200);
    }
  });
});

describe('items', () => {
  it('creates with all spec fields, audits, and rejects duplicate codes case-insensitively', async () => {
    const t = await tokenFor('MANAGER');
    const { category, unit } = await seedRefData();
    const res = await request(app)
      .post('/api/items')
      .set(bearer(t))
      .send(itemPayload(category.id, unit.id));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: 'ABC-9KG',
      hsnSac: '8424',
      trackingType: 'NONE',
      active: true,
      unit: { code: 'KG' },
      category: { name: 'Finished Goods' },
    });
    expect(Number(res.body.reorderLevel)).toBe(10);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Item', action: 'CREATE' },
    });
    expect(audit.entityId).toBe(res.body.id);
    expect(audit.userId).toBeTruthy();
    const dup = await request(app)
      .post('/api/items')
      .set(bearer(t))
      .send(itemPayload(category.id, unit.id, { code: 'Abc-9Kg' }));
    expect(dup.status).toBe(409);
  });

  it('validates levels, HSN, quantities, and references', async () => {
    const t = await tokenFor('MANAGER');
    const { category, unit } = await seedRefData();
    const post = (over: object) =>
      request(app)
        .post('/api/items')
        .set(bearer(t))
        .send(itemPayload(category.id, unit.id, over));
    expect((await post({ minLevel: 20, reorderLevel: 10 })).status).toBe(400);
    expect((await post({ hsnSac: 'abc' })).status).toBe(400);
    expect((await post({ minLevel: -1 })).status).toBe(400);
    expect((await post({ maxLevel: 1.2345 })).status).toBe(400);
    expect((await post({ gstRate: 101 })).status).toBe(400);
    expect((await post({ trackingType: 'LOT' })).status).toBe(400);
    const missing = await post({ categoryId: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(422);
    await prisma.unit.update({ where: { id: unit.id }, data: { active: false } });
    expect((await post({})).status).toBe(422);
  });

  it('DB constraints reject bad levels even if the API is bypassed', async () => {
    const { category, unit } = await seedRefData();
    await expect(
      prisma.item.create({
        data: {
          code: 'X',
          name: 'X',
          categoryId: category.id,
          unitId: unit.id,
          productType: 'OTHER',
          minLevel: 9,
          reorderLevel: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it('DELETE deactivates (never removes); deleting an inactive item is rejected; activate restores', async () => {
    const t = await tokenFor('ADMIN');
    const { category, unit } = await seedRefData();
    const { body: item } = await request(app)
      .post('/api/items')
      .set(bearer(t))
      .send(itemPayload(category.id, unit.id));

    const del = await request(app).delete(`/api/items/${item.id}`).set(bearer(t));
    expect(del.status).toBe(200);
    expect(del.body.active).toBe(false);
    expect(await prisma.item.count()).toBe(1); // still physically there

    const again = await request(app).delete(`/api/items/${item.id}`).set(bearer(t));
    expect(again.status).toBe(409);
    expect(await prisma.item.count()).toBe(1);

    const act = await request(app).post(`/api/items/${item.id}/activate`).set(bearer(t));
    expect(act.body.active).toBe(true);
    expect((await request(app).post(`/api/items/${item.id}/activate`).set(bearer(t))).status).toBe(
      409,
    );

    const actions = (
      await prisma.auditLog.findMany({
        where: { entityId: item.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['CREATE', 'DEACTIVATE', 'ACTIVATE']);
  });

  it('update records old and new values in the audit log', async () => {
    const t = await tokenFor('MANAGER');
    const { category, unit } = await seedRefData();
    const { body: item } = await request(app)
      .post('/api/items')
      .set(bearer(t))
      .send(itemPayload(category.id, unit.id));
    const res = await request(app)
      .put(`/api/items/${item.id}`)
      .set(bearer(t))
      .send(itemPayload(category.id, unit.id, { name: 'ABC 9 KG (renamed)' }));
    expect(res.status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'UPDATE', entity: 'Item' },
    });
    expect((audit.oldValue as { name: string }).name).toBe('ABC 9 KG');
    expect((audit.newValue as { name: string }).name).toBe('ABC 9 KG (renamed)');
  });

  it('search, status filter, and pagination', async () => {
    const t = await tokenFor('ADMIN');
    const { category, unit } = await seedRefData();
    for (let i = 1; i <= 25; i++) {
      await request(app)
        .post('/api/items')
        .set(bearer(t))
        .send(
          itemPayload(category.id, unit.id, {
            code: `SKU-${i}`,
            name: i === 7 ? 'Special Valve' : `Thing ${i}`,
          }),
        );
    }
    const page1 = await request(app).get('/api/items?pageSize=10').set(bearer(t));
    expect(page1.body).toMatchObject({ page: 1, pageSize: 10, total: 25 });
    expect(page1.body.data).toHaveLength(10);
    const page3 = await request(app).get('/api/items?pageSize=10&page=3').set(bearer(t));
    expect(page3.body.data).toHaveLength(5);
    const search = await request(app).get('/api/items?q=valve').set(bearer(t));
    expect(search.body.data.map((i: { code: string }) => i.code)).toEqual(['SKU-7']);
    const item7 = search.body.data[0];
    await request(app).delete(`/api/items/${item7.id}`).set(bearer(t));
    expect((await request(app).get('/api/items?q=valve').set(bearer(t))).body.total).toBe(0);
    expect(
      (await request(app).get('/api/items?q=valve&status=inactive').set(bearer(t))).body.total,
    ).toBe(1);
    expect((await request(app).get('/api/items?status=all').set(bearer(t))).body.total).toBe(25);
    expect((await request(app).get('/api/items?pageSize=9999').set(bearer(t))).status).toBe(400);
  });
});

describe('other masters', () => {
  it('client: validates GSTIN/email/phone, normalises, audits, soft-deletes', async () => {
    const t = await tokenFor('MANAGER');
    const bad = await request(app)
      .post('/api/clients')
      .set(bearer(t))
      .send({ companyName: 'Acme', gstin: 'NOTAGSTIN', email: 'nope', phone: 'abc' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'email',
      'gstin',
      'phone',
    ]);
    const ok = await request(app)
      .post('/api/clients')
      .set(bearer(t))
      .send({
        companyName: 'Acme',
        gstin: '27aaacx1234a1z5',
        email: 'A@Acme.com',
        phone: '+91 98765 43210',
        address: '',
      });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ gstin: '27AAACX1234A1Z5', email: 'a@acme.com', address: null });
    expect(
      (await request(app).delete(`/api/clients/${ok.body.id}`).set(bearer(t))).body.active,
    ).toBe(false);
    expect((await request(app).delete(`/api/clients/${ok.body.id}`).set(bearer(t))).status).toBe(
      409,
    );
    expect(await prisma.client.count()).toBe(1);
  });

  it('supplier CRUD works and is searchable', async () => {
    const t = await tokenFor('ADMIN');
    await request(app)
      .post('/api/suppliers')
      .set(bearer(t))
      .send({ companyName: 'Valve Traders', contactPerson: 'Ravi' });
    await request(app).post('/api/suppliers').set(bearer(t)).send({ companyName: 'Hose Co' });
    const res = await request(app).get('/api/suppliers?q=ravi').set(bearer(t));
    expect(res.body.data.map((s: { companyName: string }) => s.companyName)).toEqual([
      'Valve Traders',
    ]);
  });

  it('units: code normalised to upper-case and unique; categories unique case-insensitively', async () => {
    const t = await tokenFor('ADMIN');
    const u = await request(app)
      .post('/api/units')
      .set(bearer(t))
      .send({ code: 'nos', name: 'Numbers' });
    expect(u.body.code).toBe('NOS');
    expect(
      (await request(app).post('/api/units').set(bearer(t)).send({ code: 'NOS', name: 'Dup' }))
        .status,
    ).toBe(409);
    expect(
      (await request(app).post('/api/units').set(bearer(t)).send({ code: 'bad code!', name: 'x' }))
        .status,
    ).toBe(400);
    await request(app).post('/api/categories').set(bearer(t)).send({ name: 'Spare' });
    expect(
      (await request(app).post('/api/categories').set(bearer(t)).send({ name: 'SPARE' })).status,
    ).toBe(409);
  });

  it('unknown ids give 404 and malformed ids give 400', async () => {
    const t = await tokenFor('ADMIN');
    expect(
      (await request(app).get('/api/items/00000000-0000-4000-8000-000000000000').set(bearer(t)))
        .status,
    ).toBe(404);
    expect((await request(app).get('/api/items/not-a-uuid').set(bearer(t))).status).toBe(400);
  });
});
