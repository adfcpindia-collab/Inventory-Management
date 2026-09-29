import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Lets one test make the Nth ledger post fail, to prove a conversion rolls back atomically.
const inject = vi.hoisted(() => ({ failOnCall: null as number | null, calls: 0 }));
vi.mock('../src/modules/inventory/inventory.service', async (orig) => {
  const actual = await orig<typeof import('../src/modules/inventory/inventory.service')>();
  return {
    ...actual,
    post: (...args: Parameters<typeof actual.post>) => {
      inject.calls++;
      if (inject.failOnCall !== null && inject.calls === inject.failOnCall) throw new Error('injected failure');
      return actual.post(...args);
    },
  };
});

import { prisma } from '../src/lib/prisma';
import { post, reconcile } from '../src/modules/inventory/inventory.service';
import { app, bearer, isoDate, resetDb, seedWorld, tokenFor } from './helpers';

let w: Awaited<ReturnType<typeof seedWorld>>;
// items: 0 Empty Body, 1 Valve, 2 Hose, 3 DCP 9KG, 4 Water 9KG, 5 Finished Extinguisher
const ID = (i: number) => w.items[i]!.id;

beforeEach(async () => {
  await resetDb();
  inject.failOnCall = null;
  inject.calls = 0;
  w = await seedWorld(6);
});

const stock = async (i: number, status: 'USABLE' | 'DAMAGED' = 'USABLE') =>
  Number(
    (
      await prisma.stockBalance.findUnique({
        where: { itemId_warehouseId_stockStatus: { itemId: ID(i), warehouseId: w.warehouse.id, stockStatus: status } },
      })
    )?.qty ?? 0,
  );
const expectReconciled = async () => {
  const r = await reconcile();
  expect(r.mismatches).toEqual([]);
};
async function receive(i: number, qty: number, daysAgo = 0) {
  const user = await prisma.user.findFirstOrThrow();
  await post({ type: 'PROCUREMENT', txnDate: isoDate(-daysAgo), userId: user.id, lines: [{ itemId: ID(i), warehouseId: w.warehouse.id, direction: 'IN', qty }] });
}
const conv = (over: object = {}) => ({
  txnDate: isoDate(0),
  inputs: [{ itemId: ID(0), qty: 10 }],
  outputs: [{ itemId: ID(3), qty: 10 }],
  ...over,
});
const createConv = (t: string, over: object = {}) => request(app).post('/api/conversions').set(bearer(t)).send(conv(over));
const confirm = (t: string, id: string) => request(app).post(`/api/conversions/${id}/confirm`).set(bearer(t));
const cancel = (t: string, id: string, reason = 'operator error') => request(app).post(`/api/conversions/${id}/cancel`).set(bearer(t)).send({ reason });
const mkTemplate = (t: string, over: object = {}) =>
  request(app).post('/api/conversion-templates').set(bearer(t)).send({
    name: 'Extinguisher assembly',
    inputs: [{ itemId: ID(0), qty: 1 }, { itemId: ID(1), qty: 1 }, { itemId: ID(2), qty: 2 }],
    outputs: [{ itemId: ID(5), qty: 1 }],
    ...over,
  });

describe('conversion engine', () => {
  it('1→1: ABC Empty Body → DCP 9 KG posts OUT + IN as two linked ledger entries', async () => {
    const t = await tokenFor('STORE');
    await receive(0, 20);
    const c = await createConv(t);
    expect(c.status).toBe(201);
    expect(c.body.conversionNo).toMatch(/^CONV-\d{6}$/);
    expect(c.body.status).toBe('DRAFT');
    expect(await stock(0)).toBe(20); // draft has no effect
    const ok = await confirm(t, c.body.id);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CONFIRMED');
    expect(await stock(0)).toBe(10);
    expect(await stock(3)).toBe(10);
    const out = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: ok.body.outTxnId }, include: { lines: true } });
    const inn = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: ok.body.inTxnId }, include: { lines: true } });
    expect(out).toMatchObject({ type: 'CONVERSION_OUT', referenceNo: c.body.conversionNo, groupId: c.body.conversionNo });
    expect(inn).toMatchObject({ type: 'CONVERSION_IN', referenceNo: c.body.conversionNo, groupId: c.body.conversionNo });
    expect(out.lines[0]).toMatchObject({ itemId: ID(0), stockStatus: 'USABLE' });
    expect(Number(out.lines[0]!.qtyOut)).toBe(10);
    expect(Number(inn.lines[0]!.qtyIn)).toBe(10);
    expect(ok.body.totals).toEqual({ inputQty: '10', outputQty: '10' });
    await expectReconciled();
    const actions = (await prisma.auditLog.findMany({ where: { entity: 'Conversion' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['CREATE', 'CONFIRM']);
  });

  it('N→M: Empty Body + Valve + Hose → Finished Extinguisher, and 1→N', async () => {
    const t = await tokenFor('STORE');
    await receive(0, 5); await receive(1, 5); await receive(2, 10);
    const a = await createConv(t, { inputs: [{ itemId: ID(0), qty: 3 }, { itemId: ID(1), qty: 3 }, { itemId: ID(2), qty: 6 }], outputs: [{ itemId: ID(5), qty: 3 }] });
    expect((await confirm(t, a.body.id)).status).toBe(200);
    expect([await stock(0), await stock(1), await stock(2), await stock(5)]).toEqual([2, 2, 4, 3]);
    await expectReconciled();
    // one input split into two outputs
    const b = await createConv(t, { inputs: [{ itemId: ID(5), qty: 2 }], outputs: [{ itemId: ID(3), qty: '1.5' }, { itemId: ID(4), qty: '0.5' }] });
    expect((await confirm(t, b.body.id)).status).toBe(200);
    expect([await stock(5), await stock(3), await stock(4)]).toEqual([1, 1.5, 0.5]);
    await expectReconciled();
  });

  it('insufficient stock on ANY input rejects the whole conversion and changes nothing', async () => {
    const t = await tokenFor('STORE');
    await receive(0, 5); await receive(1, 5); await receive(2, 3); // hose short: need 4
    const c = await createConv(t, { inputs: [{ itemId: ID(0), qty: 2 }, { itemId: ID(1), qty: 2 }, { itemId: ID(2), qty: 4 }], outputs: [{ itemId: ID(5), qty: 2 }] });
    const before = await prisma.inventoryTransaction.count();
    const res = await confirm(t, c.body.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ITEM-3 \(available 3\.000, needed 4\.000\)/);
    expect([await stock(0), await stock(1), await stock(2), await stock(5)]).toEqual([5, 5, 3, 0]);
    expect(await prisma.inventoryTransaction.count()).toBe(before);
    expect((await prisma.conversion.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe('DRAFT');
    await expectReconciled();
  });

  it('damaged stock cannot be converted', async () => {
    const t = await tokenFor('STORE');
    const user = await prisma.user.findFirstOrThrow();
    await post({ type: 'PROCUREMENT', txnDate: isoDate(0), userId: user.id, lines: [{ itemId: ID(0), warehouseId: w.warehouse.id, direction: 'IN', qty: 9, stockStatus: 'DAMAGED' }] });
    const c = await createConv(t);
    expect((await confirm(t, c.body.id)).status).toBe(409);
    expect(await stock(0, 'DAMAGED')).toBe(9);
  });

  it('is atomic: if posting the outputs fails after the inputs were taken, everything rolls back', async () => {
    const t = await tokenFor('STORE');
    await receive(0, 10);
    const c = await createConv(t);
    inject.calls = 0;
    inject.failOnCall = 2; // 1st post = CONVERSION_OUT (succeeds), 2nd = CONVERSION_IN (throws)
    const res = await confirm(t, c.body.id);
    expect(res.status).toBe(500);
    inject.failOnCall = null;
    expect(await stock(0)).toBe(10); // inputs NOT consumed
    expect(await stock(3)).toBe(0);
    expect(await prisma.inventoryTransaction.count({ where: { type: { in: ['CONVERSION_OUT', 'CONVERSION_IN'] } } })).toBe(0);
    const doc = await prisma.conversion.findUniqueOrThrow({ where: { id: c.body.id } });
    expect(doc).toMatchObject({ status: 'DRAFT', outTxnId: null, inTxnId: null });
    await expectReconciled();
    expect((await confirm(t, c.body.id)).status).toBe(200); // and it works once the fault is gone
    expect(await stock(3)).toBe(10);
  });

  it('validation: needs inputs and outputs, positive qty, active items, own units, no item on both sides', async () => {
    const t = await tokenFor('STORE');
    const bad = async (over: object, status: number) => expect((await createConv(t, over)).status).toBe(status);
    await bad({ inputs: [] }, 400);
    await bad({ outputs: [] }, 400);
    await bad({ inputs: undefined, outputs: undefined }, 400);
    await bad({ inputs: [{ itemId: ID(0), qty: 0 }] }, 400);
    await bad({ inputs: [{ itemId: ID(0), qty: -1 }] }, 400);
    await bad({ inputs: [{ itemId: ID(0), qty: 1.2345 }] }, 400);
    await bad({ inputs: [{ itemId: ID(0), qty: 1 }], outputs: [{ itemId: ID(0), qty: 1 }] }, 400); // same item both sides
    const otherUnit = await prisma.unit.create({ data: { code: 'NOS', name: 'Numbers' } });
    await bad({ inputs: [{ itemId: ID(0), qty: 1, unitId: otherUnit.id }] }, 422);
    await bad({ inputs: [{ itemId: '00000000-0000-4000-8000-000000000000', qty: 1 }] }, 422);
    await prisma.item.update({ where: { id: ID(3) }, data: { active: false } });
    await bad({}, 422);
    expect(await prisma.conversion.count()).toBe(0);
  });

  it('an item deactivated after drafting blocks confirm', async () => {
    const t = await tokenFor('STORE');
    await receive(0, 10);
    const c = await createConv(t);
    await prisma.item.update({ where: { id: ID(3) }, data: { active: false } });
    expect((await confirm(t, c.body.id)).status).toBe(422);
    expect(await stock(0)).toBe(10);
  });

  it('drafts are editable; confirmed are not; conversion numbers are unique and sequential', async () => {
    const t = await tokenFor('STORE');
    await receive(0, 10);
    const a = await createConv(t);
    const b = await createConv(t);
    expect(a.body.conversionNo).not.toBe(b.body.conversionNo);
    const edit = await request(app).put(`/api/conversions/${a.body.id}`).set(bearer(t)).send(conv({ inputs: [{ itemId: ID(0), qty: 4 }], outputs: [{ itemId: ID(3), qty: 4 }] }));
    expect(edit.status).toBe(200);
    expect(edit.body.inputs[0].qty).toBe('4');
    await confirm(t, a.body.id);
    expect((await request(app).put(`/api/conversions/${a.body.id}`).set(bearer(t)).send(conv())).status).toBe(409);
    expect(await stock(3)).toBe(4);
  });

  it('idempotent create (Idempotency-Key) and double/parallel confirm post exactly once', async () => {
    const t = await tokenFor('STORE');
    await receive(0, 10);
    const go = () => request(app).post('/api/conversions').set(bearer(t)).set('Idempotency-Key', 'cv-1').send(conv());
    const [a, b] = [await go(), await go()];
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.conversion.count()).toBe(1);
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => confirm(t, a.body.id)));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(await stock(0)).toBe(0);
    expect(await stock(3)).toBe(10);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'CONVERSION_OUT' } })).toBe(1);
    await expectReconciled();
  });

  it('concurrent conversions competing for the same input: only what is available converts', async () => {
    const t = await tokenFor('STORE');
    await receive(0, 10);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await createConv(t, { inputs: [{ itemId: ID(0), qty: 4 }], outputs: [{ itemId: ID(3), qty: 4 }] })).body.id);
    const res = await Promise.all(ids.map((id) => confirm(t, id)));
    expect(res.filter((r) => r.status === 200)).toHaveLength(2);
    expect(res.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stock(0)).toBe(2);
    expect(await stock(3)).toBe(8);
    await expectReconciled();
  });

  it('role rules: viewer read-only; store cannot backdate or cancel', async () => {
    const store = await tokenFor('STORE');
    const viewer = await tokenFor('VIEWER');
    const mgr = await tokenFor('MANAGER');
    await receive(0, 10, 5); // stock existed on the backdated day
    expect((await createConv(viewer)).status).toBe(403);
    const old = await createConv(store, { txnDate: isoDate(-2) });
    expect((await confirm(store, old.body.id)).status).toBe(403);
    expect((await confirm(mgr, old.body.id)).status).toBe(200);
    expect((await cancel(store, old.body.id)).status).toBe(403);
    expect((await request(app).get('/api/conversions').set(bearer(viewer))).status).toBe(200);
  });
});

describe('templates and scaling', () => {
  it('creates a template (N→M recipe), unique name, roles, soft delete', async () => {
    const mgr = await tokenFor('MANAGER');
    const store = await tokenFor('STORE');
    expect((await mkTemplate(store)).status).toBe(403);
    const t = await mkTemplate(mgr);
    expect(t.status).toBe(201);
    expect(t.body.inputs).toHaveLength(3);
    expect(t.body.outputs).toHaveLength(1);
    expect((await mkTemplate(mgr, { name: 'EXTINGUISHER ASSEMBLY' })).status).toBe(409);
    expect((await mkTemplate(mgr, { name: 'x', inputs: [{ itemId: ID(0), qty: 1 }], outputs: [{ itemId: ID(0), qty: 1 }] })).status).toBe(400);
    expect((await mkTemplate(mgr, { name: 'y', inputs: [] })).status).toBe(400);
    const del = await request(app).delete(`/api/conversion-templates/${t.body.id}`).set(bearer(mgr));
    expect(del.body.active).toBe(false);
    expect((await request(app).delete(`/api/conversion-templates/${t.body.id}`).set(bearer(mgr))).status).toBe(409);
    expect(await prisma.conversionTemplate.count()).toBe(1);
    expect((await request(app).post(`/api/conversion-templates/${t.body.id}/activate`).set(bearer(mgr))).body.active).toBe(true);
    const edit = await request(app).put(`/api/conversion-templates/${t.body.id}`).set(bearer(mgr)).send({ name: 'Assembly v2', inputs: [{ itemId: ID(0), qty: 1 }], outputs: [{ itemId: ID(5), qty: 1 }] });
    expect(edit.body.inputs).toHaveLength(1);
    const list = await request(app).get('/api/conversion-templates?q=v2').set(bearer(store));
    expect(list.body.total).toBe(1);
  });

  it('template quantities scale by the multiplier and the conversion consumes exactly that', async () => {
    const mgr = await tokenFor('MANAGER');
    const store = await tokenFor('STORE');
    const t = await mkTemplate(mgr);
    const ex = await request(app).get(`/api/conversion-templates/${t.body.id}/expand?multiplier=5`).set(bearer(store));
    expect(ex.body.inputs.map((l: { qty: string }) => l.qty)).toEqual(['5', '5', '10']);
    expect(ex.body.outputs[0].qty).toBe('5');
    await receive(0, 8); await receive(1, 8); await receive(2, 20);
    const c = await request(app).post('/api/conversions').set(bearer(store)).send({ txnDate: isoDate(0), templateId: t.body.id, multiplier: 5 });
    expect(c.status).toBe(201);
    expect(c.body.template.name).toBe('Extinguisher assembly');
    expect(c.body.multiplier).toBe('5');
    expect(c.body.inputs.map((l: { qty: string }) => l.qty)).toEqual(['5', '5', '10']);
    expect((await confirm(store, c.body.id)).status).toBe(200);
    expect([await stock(0), await stock(1), await stock(2), await stock(5)]).toEqual([3, 3, 10, 5]);
    await expectReconciled();
    // multiplier 2 needs 4 hose but only 10... fine; multiplier 6 needs 6/6/12 → insufficient
    const big = await request(app).post('/api/conversions').set(bearer(store)).send({ txnDate: isoDate(0), templateId: t.body.id, multiplier: 6 });
    const res = await confirm(store, big.body.id);
    expect(res.status).toBe(409);
    await expectReconciled();
  });

  it('fractional scaling is exact decimal arithmetic (no float drift)', async () => {
    const mgr = await tokenFor('MANAGER');
    const t = await mkTemplate(mgr, { name: 'frac', inputs: [{ itemId: ID(0), qty: '0.1' }], outputs: [{ itemId: ID(3), qty: '0.125' }] });
    const ex = await request(app).get(`/api/conversion-templates/${t.body.id}/expand?multiplier=3`).set(bearer(mgr));
    expect(ex.body.inputs[0].qty).toBe('0.3'); // 0.1 * 3 is 0.30000000000000004 in floating point
    expect(ex.body.outputs[0].qty).toBe('0.375');
    const ex2 = await request(app).get(`/api/conversion-templates/${t.body.id}/expand?multiplier=2.5`).set(bearer(mgr));
    expect(ex2.status).toBe(422); // 0.125 * 2.5 = 0.3125 needs 4 decimals
  });

  it('explicit lines override the template; inactive/unknown templates are rejected', async () => {
    const mgr = await tokenFor('MANAGER');
    const t = await mkTemplate(mgr);
    const c = await request(app).post('/api/conversions').set(bearer(mgr)).send({ txnDate: isoDate(0), templateId: t.body.id, multiplier: 2, inputs: [{ itemId: ID(0), qty: 1 }], outputs: [{ itemId: ID(5), qty: 1 }] });
    expect(c.body.inputs).toHaveLength(1);
    expect(c.body.templateId).toBe(t.body.id);
    await request(app).delete(`/api/conversion-templates/${t.body.id}`).set(bearer(mgr));
    const inactive = await request(app).post('/api/conversions').set(bearer(mgr)).send({ txnDate: isoDate(0), templateId: t.body.id });
    expect(inactive.status).toBe(422);
    const unknown = await request(app).post('/api/conversions').set(bearer(mgr)).send({ txnDate: isoDate(0), templateId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.status).toBe(422);
    expect((await request(app).get(`/api/conversion-templates/${t.body.id}/expand?multiplier=0`).set(bearer(mgr))).status).toBe(400);
  });
});

describe('scaling precision', () => {
  it('rejects a multiplier whose scaled quantity exceeds 3 decimals', async () => {
    const mgr = await tokenFor('MANAGER');
    const t = await mkTemplate(mgr, { name: 'prec', inputs: [{ itemId: ID(0), qty: '0.125' }], outputs: [{ itemId: ID(3), qty: '1' }] });
    // 0.125 × 0.5 = 0.0625 (4 dp) → refuse
    const res = await request(app).post('/api/conversions').set(bearer(mgr)).send({ txnDate: isoDate(0), templateId: t.body.id, multiplier: 0.5 });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/more than 3 decimal places/);
    expect(await prisma.conversion.count()).toBe(0);
  });
});

describe('reversal', () => {
  it('cancelling a confirmed conversion reverses ALL lines together', async () => {
    const mgr = await tokenFor('MANAGER');
    await receive(0, 5); await receive(1, 5); await receive(2, 10);
    const c = await createConv(mgr, { inputs: [{ itemId: ID(0), qty: 3 }, { itemId: ID(1), qty: 3 }, { itemId: ID(2), qty: 6 }], outputs: [{ itemId: ID(5), qty: 3 }, { itemId: ID(4), qty: 1 }] });
    const ok = await confirm(mgr, c.body.id);
    await expectReconciled();
    const res = await cancel(mgr, c.body.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'operator error' });
    expect([await stock(0), await stock(1), await stock(2), await stock(5), await stock(4)]).toEqual([5, 5, 10, 0, 0]);
    const revs = await prisma.inventoryTransaction.findMany({ where: { type: 'REVERSAL' }, include: { lines: true } });
    expect(revs.map((r) => r.reversesTxnId).sort()).toEqual([ok.body.outTxnId, ok.body.inTxnId].sort());
    expect(revs.reduce((n, r) => n + r.lines.length, 0)).toBe(5);
    await expectReconciled();
    expect((await cancel(mgr, c.body.id)).status).toBe(409);
    expect((await confirm(mgr, c.body.id)).status).toBe(409);
    const actions = (await prisma.auditLog.findMany({ where: { entity: 'Conversion' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['CREATE', 'CONFIRM', 'CANCEL']);
  });

  it('is blocked when the outputs were already consumed, and leaves everything unchanged', async () => {
    const mgr = await tokenFor('MANAGER');
    await receive(0, 10);
    const c = await createConv(mgr);
    await confirm(mgr, c.body.id); // 10 body → 10 DCP
    const user = await prisma.user.findFirstOrThrow();
    await post({ type: 'DISPATCH', txnDate: isoDate(0), userId: user.id, lines: [{ itemId: ID(3), warehouseId: w.warehouse.id, direction: 'OUT', qty: 7 }] });
    const before = await prisma.inventoryTransaction.count();
    const res = await cancel(mgr, c.body.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Cannot reverse CONV-.*ITEM-4 \(available 3\.000, needed 10\.000\)/);
    expect(await stock(0)).toBe(0);
    expect(await stock(3)).toBe(3);
    expect(await prisma.inventoryTransaction.count()).toBe(before); // no partial reversal
    expect((await prisma.conversion.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe('CONFIRMED');
    await expectReconciled();
  });

  it('cancelling a draft has no stock effect', async () => {
    const mgr = await tokenFor('MANAGER');
    await receive(0, 4);
    const c = await createConv(mgr);
    expect((await cancel(mgr, c.body.id)).body.status).toBe('CANCELLED');
    expect(await stock(0)).toBe(4);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'REVERSAL' } })).toBe(0);
  });
});

describe('manager approval above a quantity threshold', () => {
  const setThreshold = (t: string, v: number | null) => request(app).put('/api/settings').set(bearer(t)).send({ conversionApprovalThreshold: v });

  it('only ADMIN can change the threshold; it is validated and audited', async () => {
    const admin = await tokenFor('ADMIN');
    expect((await setThreshold(await tokenFor('MANAGER'), 50)).status).toBe(403);
    expect((await setThreshold(admin, 0)).status).toBe(400);
    expect((await setThreshold(admin, -5)).status).toBe(400);
    expect((await setThreshold(admin, 50)).body).toEqual({ conversionApprovalThreshold: 50 });
    expect((await request(app).get('/api/settings').set(bearer(await tokenFor('STORE')))).body.conversionApprovalThreshold).toBe(50);
    expect((await setThreshold(admin, null)).body.conversionApprovalThreshold).toBeNull();
    expect(await prisma.auditLog.count({ where: { entity: 'Setting' } })).toBe(2);
  });

  it('store confirm over the threshold parks the draft as PENDING; a manager confirming approves it', async () => {
    const admin = await tokenFor('ADMIN');
    const store = await tokenFor('STORE');
    const mgr = await tokenFor('MANAGER');
    await setThreshold(admin, 15);
    await receive(0, 100);
    const c = await createConv(store, { inputs: [{ itemId: ID(0), qty: 20 }], outputs: [{ itemId: ID(3), qty: 20 }] });
    const pending = await confirm(store, c.body.id);
    expect(pending.status).toBe(202);
    expect(pending.body).toMatchObject({ status: 'DRAFT', approvalStatus: 'PENDING' });
    expect(await stock(0)).toBe(100);
    expect((await confirm(store, c.body.id)).status).toBe(202); // still pending, no change
    const approved = await confirm(mgr, c.body.id);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'CONFIRMED', approvalStatus: 'APPROVED' });
    expect(approved.body.approvedById).toBeTruthy();
    expect(await stock(0)).toBe(80);
    expect(await stock(3)).toBe(20);
    const actions = (await prisma.auditLog.findMany({ where: { entity: 'Conversion' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['CREATE', 'REQUEST_APPROVAL', 'CONFIRM']);
    await expectReconciled();
  });

  it('at or below the threshold a store user confirms directly; editing resets a pending approval', async () => {
    const admin = await tokenFor('ADMIN');
    const store = await tokenFor('STORE');
    await setThreshold(admin, 15);
    await receive(0, 100);
    const small = await createConv(store, { inputs: [{ itemId: ID(0), qty: 15 }], outputs: [{ itemId: ID(3), qty: 15 }] }); // == threshold → no approval
    expect((await confirm(store, small.body.id)).status).toBe(200);
    const big = await createConv(store, { inputs: [{ itemId: ID(0), qty: 30 }], outputs: [{ itemId: ID(3), qty: 30 }] });
    expect((await confirm(store, big.body.id)).status).toBe(202);
    const edit = await request(app).put(`/api/conversions/${big.body.id}`).set(bearer(store)).send(conv({ inputs: [{ itemId: ID(0), qty: 5 }], outputs: [{ itemId: ID(3), qty: 5 }] }));
    expect(edit.body.approvalStatus).toBe('NONE');
    expect((await confirm(store, big.body.id)).status).toBe(200); // now under the threshold
    await expectReconciled();
  });

  it('a manager needs no separate step and with no threshold nobody needs approval', async () => {
    const admin = await tokenFor('ADMIN');
    const store = await tokenFor('STORE');
    await receive(0, 100);
    const a = await createConv(store, { inputs: [{ itemId: ID(0), qty: 60 }], outputs: [{ itemId: ID(3), qty: 60 }] });
    expect((await confirm(store, a.body.id)).status).toBe(200); // threshold unset
    await setThreshold(admin, 10);
    const b = await createConv(admin, { inputs: [{ itemId: ID(0), qty: 20 }], outputs: [{ itemId: ID(3), qty: 20 }] });
    const r = await confirm(admin, b.body.id);
    expect(r.status).toBe(200);
    expect(r.body.approvalStatus).toBe('APPROVED');
  });
});

describe('listing', () => {
  it('search covers number, template, remarks and items; filters by status', async () => {
    const mgr = await tokenFor('MANAGER');
    const t = await mkTemplate(mgr);
    await receive(0, 10);
    const a = await createConv(mgr, { remarks: 'batch for Acme' });
    await request(app).post('/api/conversions').set(bearer(mgr)).send({ txnDate: isoDate(0), templateId: t.body.id });
    await confirm(mgr, a.body.id);
    const n = async (q: string) => (await request(app).get(`/api/conversions?${q}`).set(bearer(mgr))).body.total;
    expect(await n('')).toBe(2);
    expect(await n(`q=${a.body.conversionNo}`)).toBe(1);
    expect(await n('q=acme')).toBe(1);
    expect(await n('q=assembly')).toBe(1);
    expect(await n('q=ITEM-6')).toBe(1); // output item of the template
    expect(await n('status=CONFIRMED')).toBe(1);
    expect(await n('status=DRAFT')).toBe(1);
  });
});
