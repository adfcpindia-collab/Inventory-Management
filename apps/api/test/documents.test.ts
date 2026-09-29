import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/lib/prisma';
import { post, reconcile } from '../src/modules/inventory/inventory.service';
import { app, bearer, isoDate, resetDb, seedWorld, tokenFor } from './helpers';

let w: Awaited<ReturnType<typeof seedWorld>>;
let supplier: { id: string };
let client: { id: string };
beforeEach(async () => {
  await resetDb();
  w = await seedWorld(3);
  supplier = await prisma.supplier.create({ data: { companyName: 'Valve Traders' } });
  client = await prisma.client.create({ data: { companyName: 'Acme Fire', address: '12 Main Rd' } });
});

const stock = async (i: number, status: 'USABLE' | 'DAMAGED' = 'USABLE') =>
  Number(
    (
      await prisma.stockBalance.findUnique({
        where: { itemId_warehouseId_stockStatus: { itemId: w.items[i]!.id, warehouseId: w.warehouse.id, stockStatus: status } },
      })
    )?.qty ?? 0,
  );
const ledgerCount = () => prisma.inventoryTransaction.count();

const grn = (over: object = {}) => ({
  grnNo: 'GRN-001',
  txnDate: isoDate(0),
  supplierId: supplier.id,
  lines: [
    { itemId: w.items[0]!.id, qty: 20, rate: 100, gstRate: 18, batchNo: 'B1' },
    { itemId: w.items[1]!.id, qty: '2.5', rate: 10.5 },
  ],
  ...over,
});
const challan = (over: object = {}) => ({
  challanNo: 'CH-100',
  txnDate: isoDate(0),
  clientId: client.id,
  vehicleNo: 'MH12AB1234',
  driverName: 'Ravi',
  lines: [
    { itemId: w.items[0]!.id, qty: 5, rate: 150 },
    { itemId: w.items[1]!.id, qty: 1 },
  ],
  ...over,
});

const createGrn = async (t: string, over: object = {}) => request(app).post('/api/procurements').set(bearer(t)).send(grn(over));
const confirmGrn = (t: string, id: string) => request(app).post(`/api/procurements/${id}/confirm`).set(bearer(t));
const createCh = async (t: string, over: object = {}) => request(app).post('/api/dispatches').set(bearer(t)).send(challan(over));
const confirmCh = (t: string, id: string) => request(app).post(`/api/dispatches/${id}/confirm`).set(bearer(t));
/** Stock in via a confirmed GRN so dispatch tests start from a real ledger. */
async function receive(t: string, i: number, qty: number, no: string) {
  const g = await createGrn(t, { grnNo: no, lines: [{ itemId: w.items[i]!.id, qty, rate: 1 }] });
  expect((await confirmGrn(t, g.body.id)).status).toBe(200);
}

describe('procurement', () => {
  it('draft has no stock effect; confirm posts a PROCUREMENT txn and increases stock', async () => {
    const t = await tokenFor('STORE');
    const c = await createGrn(t);
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('DRAFT');
    expect(c.body.warehouse.code).toBe('MAIN');
    expect(await stock(0)).toBe(0);
    expect(await ledgerCount()).toBe(0);

    const ok = await confirmGrn(t, c.body.id);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CONFIRMED');
    expect(await stock(0)).toBe(20);
    expect(await stock(1)).toBe(2.5);
    const txn = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: ok.body.txnId }, include: { lines: true } });
    expect(txn).toMatchObject({ type: 'PROCUREMENT', referenceNo: 'GRN-001', supplierId: supplier.id });
    expect(Number(txn.lines.find((l) => l.itemId === w.items[0]!.id)!.unitCost)).toBe(100);
    expect(txn.lines.find((l) => l.itemId === w.items[0]!.id)!.batchNo).toBe('B1');
    expect((await reconcile()).ok).toBe(true);
    const actions = (await prisma.auditLog.findMany({ where: { entity: 'Procurement' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['CREATE', 'CONFIRM']);
  });

  it('computes amounts server-side (GST defaults to the item rate) and totals', async () => {
    const t = await tokenFor('STORE');
    await prisma.item.update({ where: { id: w.items[1]!.id }, data: { gstRate: 5 } });
    const c = await createGrn(t, { lines: [{ itemId: w.items[0]!.id, qty: 3, rate: 33.33, gstRate: 18 }, { itemId: w.items[1]!.id, qty: 2, rate: 10, amount: 999999 }] });
    expect(c.body.lines.map((l: { amount: string }) => l.amount)).toEqual(['117.99', '21']);
    expect(c.body.lines[1].gstRate).toBe('5');
    expect(c.body.totals).toEqual({ taxable: '119.99', gst: '19.00', total: '138.99' });
  });

  it('rejects duplicate GRN numbers, case-insensitively, including under a race', async () => {
    const t = await tokenFor('STORE');
    expect((await createGrn(t)).status).toBe(201);
    const dup = await createGrn(t, { grnNo: 'grn-001' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already exists/);
    const race = await Promise.all([1, 2, 3, 4].map(() => createGrn(t, { grnNo: 'GRN-RACE' })));
    expect(race.filter((r) => r.status === 201)).toHaveLength(1);
    expect(race.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.procurement.count()).toBe(2);
  });

  it('validates: inactive item/supplier, unit mismatch, zero/negative qty, missing rate, no lines, bad date', async () => {
    const t = await tokenFor('STORE');
    const bad = async (over: object, status: number) => expect((await createGrn(t, { grnNo: `G${Math.random()}`, ...over })).status).toBe(status);
    const line = (o: object) => ({ lines: [{ itemId: w.items[0]!.id, qty: 1, rate: 1, ...o }] });
    await bad(line({ qty: 0 }), 400);
    await bad(line({ qty: -2 }), 400);
    await bad(line({ qty: 1.2345 }), 400);
    await bad(line({ rate: undefined }), 400);
    await bad(line({ rate: -1 }), 400);
    await bad({ lines: [] }, 400);
    await bad({ txnDate: '2025-13-40' }, 400);
    const otherUnit = await prisma.unit.create({ data: { code: 'NOS', name: 'Numbers' } });
    await bad(line({ unitId: otherUnit.id }), 422);
    await prisma.item.update({ where: { id: w.items[0]!.id }, data: { active: false } });
    await bad(line({}), 422);
    await prisma.supplier.update({ where: { id: supplier.id }, data: { active: false } });
    await bad({ lines: [{ itemId: w.items[1]!.id, qty: 1, rate: 1 }] }, 422);
    expect(await prisma.procurement.count()).toBe(0);
  });

  it('inactive item at CONFIRM time is rejected and nothing is posted', async () => {
    const t = await tokenFor('STORE');
    const c = await createGrn(t);
    await prisma.item.update({ where: { id: w.items[0]!.id }, data: { active: false } });
    expect((await confirmGrn(t, c.body.id)).status).toBe(422);
    expect(await ledgerCount()).toBe(0);
    expect((await prisma.procurement.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe('DRAFT');
  });

  it('drafts are editable, confirmed documents are not', async () => {
    const t = await tokenFor('STORE');
    const c = await createGrn(t);
    const edit = await request(app).put(`/api/procurements/${c.body.id}`).set(bearer(t)).send(grn({ remarks: 'edited', lines: [{ itemId: w.items[2]!.id, qty: 9, rate: 2 }] }));
    expect(edit.status).toBe(200);
    expect(edit.body.lines).toHaveLength(1);
    expect(edit.body.remarks).toBe('edited');
    await confirmGrn(t, c.body.id);
    expect(await stock(2)).toBe(9);
    expect((await request(app).put(`/api/procurements/${c.body.id}`).set(bearer(t)).send(grn())).status).toBe(409);
  });

  it('double-submit: same Idempotency-Key creates one document; repeated confirm posts once', async () => {
    const t = await tokenFor('STORE');
    const go = () => request(app).post('/api/procurements').set(bearer(t)).set('Idempotency-Key', 'k-1').send(grn());
    const [a, b] = [await go(), await go()];
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.procurement.count()).toBe(1);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => confirmGrn(t, a.body.id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await ledgerCount()).toBe(1);
    expect(await stock(0)).toBe(20);
  });

  it('cancel: draft has no stock effect; confirmed creates a reversal that restores stock', async () => {
    const store = await tokenFor('STORE');
    const mgr = await tokenFor('MANAGER');
    const d = await createGrn(store, { grnNo: 'G-D' });
    const cancelDraft = await request(app).post(`/api/procurements/${d.body.id}/cancel`).set(bearer(mgr)).send({ reason: 'not needed' });
    expect(cancelDraft.body.status).toBe('CANCELLED');
    expect(await ledgerCount()).toBe(0);

    const c = await createGrn(store);
    const confirmed = await confirmGrn(store, c.body.id);
    expect((await request(app).post(`/api/procurements/${c.body.id}/cancel`).set(bearer(store)).send({ reason: 'oops oops' })).status).toBe(403);
    const res = await request(app).post(`/api/procurements/${c.body.id}/cancel`).set(bearer(mgr)).send({ reason: 'entered twice' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'entered twice' });
    expect(await stock(0)).toBe(0);
    const rev = await prisma.inventoryTransaction.findFirstOrThrow({ where: { type: 'REVERSAL' } });
    expect(rev.reversesTxnId).toBe(confirmed.body.txnId);
    expect((await request(app).post(`/api/procurements/${c.body.id}/cancel`).set(bearer(mgr)).send({ reason: 'again' })).status).toBe(409);
    expect((await confirmGrn(mgr, c.body.id)).status).toBe(409);
    expect((await reconcile()).ok).toBe(true);
    // GRN number stays reserved even after cancellation
    expect((await createGrn(store)).status).toBe(409);
  });

  it('cancel is blocked when the received stock was already dispatched', async () => {
    const t = await tokenFor('MANAGER');
    const g = await createGrn(t, { lines: [{ itemId: w.items[0]!.id, qty: 10, rate: 1 }] });
    await confirmGrn(t, g.body.id);
    const c = await createCh(t, { lines: [{ itemId: w.items[0]!.id, qty: 8 }] });
    await confirmCh(t, c.body.id);
    const res = await request(app).post(`/api/procurements/${g.body.id}/cancel`).set(bearer(t)).send({ reason: 'mistake' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Cannot cancel GRN-001.*ITEM-1/);
    expect((await prisma.procurement.findUniqueOrThrow({ where: { id: g.body.id } })).status).toBe('CONFIRMED');
    expect(await stock(0)).toBe(2);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'REVERSAL' } })).toBe(0);
  });

  it('role rules: viewer read-only; store cannot confirm a backdated document', async () => {
    const store = await tokenFor('STORE');
    const viewer = await tokenFor('VIEWER');
    const mgr = await tokenFor('MANAGER');
    expect((await request(app).post('/api/procurements').set(bearer(viewer)).send(grn())).status).toBe(403);
    expect((await request(app).get('/api/procurements').set(bearer(viewer))).status).toBe(200);
    const old = await createGrn(store, { txnDate: isoDate(-3) });
    expect((await confirmGrn(store, old.body.id)).status).toBe(403);
    expect(await ledgerCount()).toBe(0);
    expect((await confirmGrn(mgr, old.body.id)).status).toBe(200);
    expect((await createGrn(store, { grnNo: 'F', txnDate: isoDate(2) })).status).toBe(201); // draft ok...
    const fut = await prisma.procurement.findFirstOrThrow({ where: { grnNo: 'F' } });
    expect((await confirmGrn(mgr, fut.id)).status).toBe(400); // ...but cannot be confirmed
  });

  it('list supports search, status and date filters with pagination', async () => {
    const t = await tokenFor('MANAGER');
    for (let i = 1; i <= 5; i++) await createGrn(t, { grnNo: `GRN-${i}`, txnDate: isoDate(-i) });
    const first = await createGrn(t, { grnNo: 'SPECIAL-9', remarks: 'urgent shipment' });
    await confirmGrn(t, first.body.id);
    const q = async (s: string) => (await request(app).get(`/api/procurements?${s}`).set(bearer(t))).body;
    expect((await q('')).total).toBe(6);
    expect((await q('pageSize=4&page=2')).data).toHaveLength(2);
    expect((await q('q=special')).total).toBe(1);
    expect((await q('q=URGENT')).total).toBe(1);
    expect((await q('q=valve')).total).toBe(6); // supplier name
    expect((await q('q=ITEM-2')).total).toBe(6); // line item
    expect((await q('status=CONFIRMED')).total).toBe(1);
    expect((await q('status=DRAFT')).total).toBe(5);
    expect((await q(`from=${isoDate(-2)}&to=${isoDate(-1)}`)).total).toBe(2);
    expect((await q(`partyId=${supplier.id}`)).total).toBe(6);
  });
});

describe('dispatch', () => {
  it('multi-item challan: confirm reduces every line and posts one DISPATCH txn for the client', async () => {
    const t = await tokenFor('STORE');
    await receive(t, 0, 50, 'G1');
    await receive(t, 1, 10, 'G2');
    const c = await createCh(t);
    expect(c.status).toBe(201);
    expect(c.body.address).toBe('12 Main Rd'); // defaulted from client
    expect(c.body.lines[0].amount).toBe('750');
    expect(c.body.lines[1].amount).toBeNull();
    expect(c.body.totals.total).toBe('750.00');
    expect(await stock(0)).toBe(50); // draft: no effect

    const ok = await confirmCh(t, c.body.id);
    expect(ok.status).toBe(200);
    expect(await stock(0)).toBe(45);
    expect(await stock(1)).toBe(9);
    const txn = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: ok.body.txnId }, include: { lines: true } });
    expect(txn).toMatchObject({ type: 'DISPATCH', referenceNo: 'CH-100', clientId: client.id });
    expect(txn.lines).toHaveLength(2);
    expect(txn.lines.every((l) => l.stockStatus === 'USABLE' && Number(l.qtyOut) > 0)).toBe(true);
    expect((await reconcile()).ok).toBe(true);
  });

  it('insufficient stock on ONE line rejects the whole challan and changes nothing', async () => {
    const t = await tokenFor('STORE');
    await receive(t, 0, 50, 'G1');
    await receive(t, 1, 1, 'G2');
    const before = await ledgerCount();
    const c = await createCh(t, { lines: [{ itemId: w.items[0]!.id, qty: 5 }, { itemId: w.items[1]!.id, qty: 2 }] });
    const res = await confirmCh(t, c.body.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ITEM-2 \(available 1\.000, needed 2\.000\)/);
    expect(res.body.error.details.shortages[0].itemCode).toBe('ITEM-2');
    expect(await stock(0)).toBe(50); // the good line was NOT applied
    expect(await stock(1)).toBe(1);
    expect(await ledgerCount()).toBe(before);
    const doc = await prisma.dispatch.findUniqueOrThrow({ where: { id: c.body.id } });
    expect(doc).toMatchObject({ status: 'DRAFT', txnId: null });
    // fix the line and it goes through
    await request(app).put(`/api/dispatches/${c.body.id}`).set(bearer(t)).send(challan({ lines: [{ itemId: w.items[0]!.id, qty: 5 }, { itemId: w.items[1]!.id, qty: 1 }] }));
    expect((await confirmCh(t, c.body.id)).status).toBe(200);
    expect(await stock(1)).toBe(0);
  });

  it('damaged / inspection stock is not available for dispatch', async () => {
    const t = await tokenFor('STORE');
    const user = await prisma.user.findFirstOrThrow();
    await post({ type: 'PROCUREMENT', txnDate: isoDate(0), userId: user.id, lines: [{ itemId: w.items[0]!.id, warehouseId: w.warehouse.id, direction: 'IN', qty: 9, stockStatus: 'DAMAGED' }] });
    const c = await createCh(t, { lines: [{ itemId: w.items[0]!.id, qty: 1 }] });
    expect((await confirmCh(t, c.body.id)).status).toBe(409);
    expect(await stock(0, 'DAMAGED')).toBe(9);
  });

  it('rejects duplicate challan numbers (case-insensitive) and validates inputs', async () => {
    const t = await tokenFor('STORE');
    expect((await createCh(t)).status).toBe(201);
    expect((await createCh(t, { challanNo: 'ch-100' })).status).toBe(409);
    const bad = async (over: object, status: number) => expect((await createCh(t, { challanNo: `C${Math.random()}`, ...over })).status).toBe(status);
    await bad({ lines: [] }, 400);
    await bad({ lines: [{ itemId: w.items[0]!.id, qty: 0 }] }, 400);
    await bad({ lines: [{ itemId: w.items[0]!.id, qty: 1, rate: -5 }] }, 400);
    await bad({ clientId: 'not-a-uuid' }, 400);
    await bad({ clientId: '00000000-0000-4000-8000-000000000000' }, 422);
    await prisma.item.update({ where: { id: w.items[0]!.id }, data: { active: false } });
    await bad({}, 422);
    await prisma.item.update({ where: { id: w.items[0]!.id }, data: { active: true } });
    await prisma.client.update({ where: { id: client.id }, data: { active: false } });
    await bad({}, 422);
    expect(await prisma.dispatch.count()).toBe(1);
  });

  it('double-click confirm: parallel confirms produce one transaction and one stock deduction', async () => {
    const t = await tokenFor('STORE');
    await receive(t, 0, 10, 'G1');
    await receive(t, 1, 10, 'G2');
    const c = await createCh(t);
    const res = await Promise.all([1, 2, 3, 4, 5, 6].map(() => confirmCh(t, c.body.id)));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(await stock(0)).toBe(5);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'DISPATCH' } })).toBe(1);
  });

  it('two challans competing for the same stock: only what is available ships', async () => {
    const t = await tokenFor('STORE');
    await receive(t, 0, 10, 'G1');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await createCh(t, { challanNo: `CH-${i}`, lines: [{ itemId: w.items[0]!.id, qty: 4 }] })).body.id);
    const res = await Promise.all(ids.map((id) => confirmCh(t, id)));
    expect(res.filter((r) => r.status === 200)).toHaveLength(2);
    expect(res.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stock(0)).toBe(2);
    expect((await reconcile()).ok).toBe(true);
  });

  it('cancel creates a reversal that returns the stock; cancelled challans cannot be confirmed', async () => {
    const store = await tokenFor('STORE');
    const mgr = await tokenFor('MANAGER');
    await receive(store, 0, 10, 'G1');
    await receive(store, 1, 10, 'G2');
    const c = await createCh(store);
    await confirmCh(store, c.body.id);
    expect(await stock(0)).toBe(5);
    expect((await request(app).post(`/api/dispatches/${c.body.id}/cancel`).set(bearer(store)).send({ reason: 'wrong client' })).status).toBe(403);
    const res = await request(app).post(`/api/dispatches/${c.body.id}/cancel`).set(bearer(mgr)).send({ reason: 'wrong client' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(await stock(0)).toBe(10);
    expect(await stock(1)).toBe(10);
    expect((await confirmCh(mgr, c.body.id)).status).toBe(409);
    expect((await request(app).put(`/api/dispatches/${c.body.id}`).set(bearer(mgr)).send(challan())).status).toBe(409);
    const audit = (await prisma.auditLog.findMany({ where: { entity: 'Dispatch' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(audit).toEqual(['CREATE', 'CONFIRM', 'CANCEL']);
    expect((await reconcile()).ok).toBe(true);
  });

  it('search finds challans by number, client, vehicle, sales order and item', async () => {
    const t = await tokenFor('MANAGER');
    await createCh(t, { challanNo: 'CH-A', salesOrderNo: 'SO-77' });
    await createCh(t, { challanNo: 'CH-B', vehicleNo: 'KA01ZZ9999', lines: [{ itemId: w.items[2]!.id, qty: 1 }] });
    const n = async (q: string) => (await request(app).get(`/api/dispatches?q=${q}`).set(bearer(t))).body.total;
    expect(await n('ch-a')).toBe(1);
    expect(await n('acme')).toBe(2);
    expect(await n('so-77')).toBe(1);
    expect(await n('ka01')).toBe(1);
    expect(await n('ITEM-3')).toBe(1);
    expect(await n('nomatch')).toBe(0);
  });

  it('GET detail returns lines with item and unit names; unknown id is 404', async () => {
    const t = await tokenFor('VIEWER');
    const st = await tokenFor('STORE');
    const c = await createCh(st);
    const d = await request(app).get(`/api/dispatches/${c.body.id}`).set(bearer(t));
    expect(d.body.lines[0]).toMatchObject({ item: { code: 'ITEM-1' }, unit: { code: 'KG' } });
    expect(d.body.client.companyName).toBe('Acme Fire');
    expect((await request(app).get('/api/dispatches/00000000-0000-4000-8000-000000000000').set(bearer(t))).status).toBe(404);
    const co = await request(app).get('/api/company').set(bearer(t));
    expect(co.body.name).toBeTruthy();
  });
});
