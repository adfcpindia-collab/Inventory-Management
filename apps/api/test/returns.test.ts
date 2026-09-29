import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { StockStatus } from '@inventory/shared';
import { prisma } from '../src/lib/prisma';
import { reconcile } from '../src/modules/inventory/inventory.service';
import { app, bearer, isoDate, resetDb, seedWorld, tokenFor } from './helpers';

let w: Awaited<ReturnType<typeof seedWorld>>;
let supplier: { id: string };
let client: { id: string };
let store: string;
let manager: string;
beforeEach(async () => {
  await resetDb();
  w = await seedWorld(3);
  supplier = await prisma.supplier.create({ data: { companyName: 'Valve Traders' } });
  client = await prisma.client.create({ data: { companyName: 'Acme Fire' } });
  store = await tokenFor('STORE');
  manager = await tokenFor('MANAGER');
});

const stock = async (i: number, status: StockStatus = 'USABLE') =>
  Number(
    (
      await prisma.stockBalance.findUnique({
        where: {
          itemId_warehouseId_stockStatus: {
            itemId: w.items[i]!.id,
            warehouseId: w.warehouse.id,
            stockStatus: status,
          },
        },
      })
    )?.qty ?? 0,
  );
const ledgerCount = () => prisma.inventoryTransaction.count();
const auditActions = async (entity: string) =>
  (await prisma.auditLog.findMany({ where: { entity }, orderBy: { createdAt: 'asc' } })).map(
    (a) => a.action,
  );
const reconciled = async () => expect((await reconcile()).ok).toBe(true);

const post = (path: string, t: string, body?: object) =>
  request(app).post(path).set(bearer(t)).send(body);
const line = (i: number, qty: number, extra: object = {}) => ({
  itemId: w.items[i]!.id,
  qty,
  ...extra,
});

/** Confirmed GRN → stock in. */
async function receive(i: number, qty: number, grnNo = `GRN-${i}-${qty}`) {
  const g = await post('/api/procurements', store, {
    grnNo,
    txnDate: isoDate(0),
    supplierId: supplier.id,
    lines: [{ itemId: w.items[i]!.id, qty, rate: 10 }],
  });
  expect((await post(`/api/procurements/${g.body.id}/confirm`, store)).status).toBe(200);
  return g.body.id as string;
}
/** Confirmed challan dispatching `qty` of item i (needs stock). */
async function dispatch(i: number, qty: number, challanNo = `CH-${i}-${qty}`) {
  const d = await post('/api/dispatches', store, {
    challanNo,
    txnDate: isoDate(0),
    clientId: client.id,
    lines: [{ itemId: w.items[i]!.id, qty }],
  });
  const c = await post(`/api/dispatches/${d.body.id}/confirm`, store);
  expect(c.status).toBe(200);
  return d.body.id as string;
}

const custReturn = (dispatchId: string, lines: object[], over: object = {}) => ({
  returnNo: 'CR-1',
  txnDate: isoDate(0),
  dispatchId,
  lines,
  ...over,
});
const createCR = (dispatchId: string, lines: object[], over: object = {}) =>
  post('/api/customer-returns', store, custReturn(dispatchId, lines, over));
const confirmCR = (id: string, t = store) => post(`/api/customer-returns/${id}/confirm`, t);

describe('customer returns', () => {
  it('routes stock by condition: GOOD → USABLE, DAMAGED → DAMAGED, NEEDS_INSPECTION → INSPECTION', async () => {
    await receive(0, 20);
    await receive(1, 20);
    const d = await prisma.dispatch.findUniqueOrThrow({ where: { id: await dispatch(0, 10) } });
    const before = await stock(0);
    const c = await createCR(d.id, [
      line(0, 2, { condition: 'GOOD' }),
      line(0, 3, { condition: 'DAMAGED', reason: 'crushed' }),
      line(0, 1, { condition: 'NEEDS_INSPECTION' }),
    ]);
    expect(c.status).toBe(201);
    expect(c.body.client.companyName).toBe('Acme Fire');
    expect(await stock(0)).toBe(before); // draft: no effect

    const ok = await confirmCR(c.body.id);
    expect(ok.status).toBe(200);
    expect(await stock(0)).toBe(before + 2);
    expect(await stock(0, 'DAMAGED')).toBe(3);
    expect(await stock(0, 'INSPECTION')).toBe(1);
    const txn = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: ok.body.txnId },
    });
    expect(txn).toMatchObject({
      type: 'CUSTOMER_RETURN',
      referenceNo: 'CR-1',
      clientId: client.id,
    });
    expect(await auditActions('CustomerReturn')).toEqual(['CREATE', 'CONFIRM']);
    await reconciled();
  });

  it('damaged / inspection returns are not available for dispatch', async () => {
    await receive(0, 5);
    const d = await dispatch(0, 5); // usable now 0
    const c = await createCR(d, [line(0, 5, { condition: 'DAMAGED' })]);
    expect((await confirmCR(c.body.id)).status).toBe(200);
    expect(await stock(0)).toBe(0);
    expect(await stock(0, 'DAMAGED')).toBe(5);
    const again = await post('/api/dispatches', store, {
      challanNo: 'CH-X',
      txnDate: isoDate(0),
      clientId: client.id,
      lines: [line(0, 1)],
    });
    const res = await post(`/api/dispatches/${again.body.id}/confirm`, store);
    expect(res.status).toBe(409);
    expect(res.body.error?.message ?? res.body.message).toMatch(/Insufficient stock/);
    await reconciled();
  });

  it('rejects returning more than was dispatched, including across earlier returns', async () => {
    await receive(0, 20);
    const d = await dispatch(0, 5);
    const over = await createCR(d, [line(0, 6, { condition: 'GOOD' })]);
    expect(over.status).toBe(409);
    expect(JSON.stringify(over.body)).toMatch(/returnable 5\.000, requested 6\.000/);

    const first = await createCR(d, [line(0, 4, { condition: 'GOOD' })]);
    expect((await confirmCR(first.body.id)).status).toBe(200);
    const second = await createCR(d, [line(0, 2, { condition: 'GOOD' })], { returnNo: 'CR-2' });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toMatch(/returnable 1\.000/);
    const exact = await createCR(d, [line(0, 1, { condition: 'GOOD' })], { returnNo: 'CR-3' });
    expect(exact.status).toBe(201);
    expect(await ledgerCount()).toBe(3); // GRN, challan, first return only
  });

  it('rejects items not on the challan, unconfirmed challans and pre-challan dates', async () => {
    await receive(0, 10);
    const d = await dispatch(0, 5);
    const foreign = await createCR(d, [line(1, 1, { condition: 'GOOD' })]);
    expect(foreign.status).toBe(422);
    expect(foreign.body.error?.message ?? foreign.body.message).toMatch(
      /Not on the original challan/,
    );

    const draft = await post('/api/dispatches', store, {
      challanNo: 'CH-D',
      txnDate: isoDate(0),
      clientId: client.id,
      lines: [line(0, 1)],
    });
    expect((await createCR(draft.body.id, [line(0, 1, { condition: 'GOOD' })])).status).toBe(422);
    expect(
      (await createCR(d, [line(0, 1, { condition: 'GOOD' })], { txnDate: isoDate(-1) })).status,
    ).toBe(422);
  });

  it('validates input: zero/negative qty, missing condition, duplicate number', async () => {
    await receive(0, 10);
    const d = await dispatch(0, 5);
    for (const bad of [
      [line(0, 0, { condition: 'GOOD' })],
      [line(0, -1, { condition: 'GOOD' })],
      [line(0, 1)],
      [line(0, 1, { condition: 'LOST' })],
    ])
      expect((await createCR(d, bad)).status).toBe(400);
    expect((await createCR(d, [line(0, 1, { condition: 'GOOD' })])).status).toBe(201);
    expect(
      (await createCR(d, [line(0, 1, { condition: 'GOOD' })], { returnNo: 'cr-1' })).status,
    ).toBe(409);
  });

  it('two concurrent confirms cannot together over-return', async () => {
    await receive(0, 20);
    const d = await dispatch(0, 5);
    const a = await createCR(d, [line(0, 4, { condition: 'GOOD' })], { returnNo: 'CR-A' });
    const b = await createCR(d, [line(0, 4, { condition: 'GOOD' })], { returnNo: 'CR-B' });
    const res = await Promise.all([confirmCR(a.body.id), confirmCR(b.body.id)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stock(0)).toBe(20 - 5 + 4);
    await reconciled();
  });

  it('cancel reverses stock and frees the quantity; challan cannot be cancelled while returns stand', async () => {
    await receive(0, 20);
    const d = await dispatch(0, 5);
    const c = await createCR(d, [line(0, 5, { condition: 'DAMAGED' })]);
    await confirmCR(c.body.id);

    const blocked = await post(`/api/dispatches/${d}/cancel`, manager, { reason: 'wrong client' });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toMatch(/CR-1/);
    expect(
      (await post(`/api/customer-returns/${c.body.id}/cancel`, store, { reason: 'oops' })).status,
    ).toBe(403);

    const cancelled = await post(`/api/customer-returns/${c.body.id}/cancel`, manager, {
      reason: 'entered twice',
    });
    expect(cancelled.status).toBe(200);
    expect(await stock(0, 'DAMAGED')).toBe(0);
    const retry = await createCR(d, [line(0, 5, { condition: 'GOOD' })], { returnNo: 'CR-9' });
    expect(retry.status).toBe(201);
    expect(await auditActions('CustomerReturn')).toContain('CANCEL');
    await reconciled();
  });

  it('cancel is refused when the returned stock was already used', async () => {
    await receive(0, 5);
    const d = await dispatch(0, 5);
    const c = await createCR(d, [line(0, 5, { condition: 'GOOD' })]);
    await confirmCR(c.body.id);
    await dispatch(0, 5, 'CH-AGAIN'); // ships the returned goods again
    const res = await post(`/api/customer-returns/${c.body.id}/cancel`, manager, { reason: 'not needed' });
    expect(res.status).toBe(409);
    expect(
      (await prisma.customerReturn.findUniqueOrThrow({ where: { id: c.body.id } })).status,
    ).toBe('CONFIRMED');
    await reconciled();
  });

  it('idempotency key on create and repeated confirm do not duplicate', async () => {
    await receive(0, 10);
    const d = await dispatch(0, 5);
    const body = custReturn(d, [line(0, 2, { condition: 'GOOD' })]);
    const k = { 'Idempotency-Key': 'ret-1' };
    const r1 = await request(app)
      .post('/api/customer-returns')
      .set(bearer(store))
      .set(k)
      .send(body);
    const r2 = await request(app)
      .post('/api/customer-returns')
      .set(bearer(store))
      .set(k)
      .send(body);
    expect(r2.body.id).toBe(r1.body.id);
    await confirmCR(r1.body.id);
    await confirmCR(r1.body.id);
    expect(await stock(0)).toBe(5 + 2);
    expect(await prisma.customerReturn.count()).toBe(1);
  });

  it('viewers cannot create', async () => {
    const v = await tokenFor('VIEWER');
    expect((await post('/api/customer-returns', v, {})).status).toBe(403);
  });
});

const suppReturn = (procurementId: string, lines: object[], over: object = {}) => ({
  returnNo: 'SR-1',
  txnDate: isoDate(0),
  procurementId,
  lines,
  ...over,
});
const createSR = (procurementId: string, lines: object[], over: object = {}) =>
  post('/api/supplier-returns', store, suppReturn(procurementId, lines, over));
const confirmSR = (id: string) => post(`/api/supplier-returns/${id}/confirm`, store);

describe('supplier returns', () => {
  it('confirm posts SUPPLIER_RETURN and reduces stock; draft has no effect', async () => {
    const g = await receive(0, 10);
    const c = await createSR(g, [line(0, 4, { reason: 'defective' })]);
    expect(c.status).toBe(201);
    expect(c.body.supplier.companyName).toBe('Valve Traders');
    expect(await stock(0)).toBe(10);
    const ok = await confirmSR(c.body.id);
    expect(ok.status).toBe(200);
    expect(await stock(0)).toBe(6);
    const txn = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: ok.body.txnId },
    });
    expect(txn).toMatchObject({
      type: 'SUPPLIER_RETURN',
      supplierId: supplier.id,
      referenceNo: 'SR-1',
    });
    expect(await auditActions('SupplierReturn')).toEqual(['CREATE', 'CONFIRM']);
    await reconciled();
  });

  it('rejects returning more than received, and more than is in stock', async () => {
    const g = await receive(0, 10);
    expect((await createSR(g, [line(0, 11)])).status).toBe(409);
    const first = await createSR(g, [line(0, 8)]);
    await confirmSR(first.body.id);
    expect((await createSR(g, [line(0, 3)], { returnNo: 'SR-2' })).status).toBe(409);
    expect((await createSR(g, [line(1, 1)], { returnNo: 'SR-3' })).status).toBe(422);

    // received 10 but 9 already dispatched → only 1 in stock (after the 8 returned: negative)
    const g2 = await receive(1, 10, 'GRN-B');
    await dispatch(1, 9);
    const short = await createSR(g2, [line(1, 5)], { returnNo: 'SR-4' });
    const res = await confirmSR(short.body.id);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/Insufficient stock/);
    expect(await stock(1)).toBe(1);
    await reconciled();
  });

  it('can return damaged stock, taken from the DAMAGED bucket', async () => {
    const g = await receive(0, 10);
    const dmg = await post('/api/stock-actions', store, {
      action: 'DAMAGE',
      txnDate: isoDate(0),
      itemId: w.items[0]!.id,
      qty: 3,
      reason: 'dropped',
    });
    await post(`/api/stock-actions/${dmg.body.id}/confirm`, store);
    const c = await createSR(g, [line(0, 3, { stockStatus: 'DAMAGED' })]);
    expect((await confirmSR(c.body.id)).status).toBe(200);
    expect(await stock(0, 'DAMAGED')).toBe(0);
    expect(await stock(0)).toBe(7);
    // no damaged stock left → a second damaged return fails on stock, not silently on usable
    const g2 = await receive(0, 5, 'GRN-C');
    const c2 = await createSR(g2, [line(0, 1, { stockStatus: 'DAMAGED' })], { returnNo: 'SR-2' });
    expect((await confirmSR(c2.body.id)).status).toBe(409);
    await reconciled();
  });

  it('cancel restores stock; GRN cannot be cancelled while a return stands', async () => {
    const g = await receive(0, 10);
    const c = await createSR(g, [line(0, 4)]);
    await confirmSR(c.body.id);
    expect((await post(`/api/procurements/${g}/cancel`, manager, { reason: 'not needed' })).status).toBe(
      409,
    );
    expect(
      (await post(`/api/supplier-returns/${c.body.id}/cancel`, manager, { reason: 'taken back' }))
        .status,
    ).toBe(200);
    expect(await stock(0)).toBe(10);
    expect((await post(`/api/procurements/${g}/cancel`, manager, { reason: 'not needed' })).status).toBe(
      200,
    );
    await reconciled();
  });
});

const action = (a: 'DAMAGE' | 'SCRAP' | 'REPAIR', qty: number, over: object = {}) => ({
  action: a,
  txnDate: isoDate(0),
  itemId: w.items[0]!.id,
  qty,
  reason: 'test reason',
  ...over,
});
const doAction = async (a: 'DAMAGE' | 'SCRAP' | 'REPAIR', qty: number, t = store) => {
  const c = await post('/api/stock-actions', t, action(a, qty));
  expect(c.status).toBe(201);
  return { c, r: await post(`/api/stock-actions/${c.body.id}/confirm`, t) };
};

describe('damage, scrap and repair', () => {
  it('DAMAGE moves usable → damaged; damaged is not available', async () => {
    await receive(0, 10);
    const { c, r } = await doAction('DAMAGE', 4);
    expect(c.body.actionNo).toMatch(/^DMG-\d{6}$/);
    expect(r.status).toBe(200);
    expect(await stock(0)).toBe(6);
    expect(await stock(0, 'DAMAGED')).toBe(4);
    const txn = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: r.body.txnId },
    });
    expect(txn.type).toBe('DAMAGE');
    // damaged stock cannot be dispatched
    const ch = await post('/api/dispatches', store, {
      challanNo: 'CH-D',
      txnDate: isoDate(0),
      clientId: client.id,
      lines: [line(0, 7)],
    });
    expect((await post(`/api/dispatches/${ch.body.id}/confirm`, store)).status).toBe(409);
    expect(await auditActions('StockAction')).toEqual(['CREATE', 'CONFIRM']);
    await reconciled();
  });

  it('cannot damage more than usable stock; nothing is written', async () => {
    await receive(0, 3);
    const before = await ledgerCount();
    const { r } = await doAction('DAMAGE', 4);
    expect(r.status).toBe(409);
    expect(await ledgerCount()).toBe(before);
    expect(await stock(0)).toBe(3);
  });

  it('SCRAP removes damaged stock only', async () => {
    await receive(0, 10);
    expect((await doAction('SCRAP', 1)).r.status).toBe(409); // nothing damaged yet
    await doAction('DAMAGE', 5);
    const { r } = await doAction('SCRAP', 2);
    expect(r.status).toBe(200);
    expect(await stock(0, 'DAMAGED')).toBe(3);
    expect(await stock(0)).toBe(5);
    expect(
      (await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: r.body.txnId } })).type,
    ).toBe('SCRAP');
    expect((await doAction('SCRAP', 4)).r.status).toBe(409);
    await reconciled();
  });

  it('REPAIR moves damaged → usable as an audited OUT/IN pair', async () => {
    await receive(0, 10);
    await doAction('DAMAGE', 5);
    const { c, r } = await doAction('REPAIR', 3);
    expect(r.status).toBe(200);
    expect(await stock(0, 'DAMAGED')).toBe(2);
    expect(await stock(0)).toBe(8);
    const legs = await prisma.inventoryTransaction.findMany({
      where: { groupId: c.body.actionNo },
      orderBy: { txnNo: 'asc' },
    });
    expect(legs.map((l) => l.type)).toEqual(['ADJUSTMENT_OUT', 'ADJUSTMENT_IN']);
    expect((await doAction('REPAIR', 3)).r.status).toBe(409);
    await reconciled();
  });

  it('requires a reason and a positive quantity', async () => {
    await receive(0, 10);
    expect(
      (await post('/api/stock-actions', store, action('DAMAGE', 1, { reason: '' }))).status,
    ).toBe(400);
    expect(
      (await post('/api/stock-actions', store, action('DAMAGE', 1, { reason: undefined }))).status,
    ).toBe(400);
    expect((await post('/api/stock-actions', store, action('DAMAGE', 0))).status).toBe(400);
    expect((await post('/api/stock-actions', store, action('DAMAGE', -2))).status).toBe(400);
  });

  it('cancel reverses; a repair reversal is refused once the repaired stock was dispatched', async () => {
    await receive(0, 10);
    const dmg = await doAction('DAMAGE', 4);
    const rep = await doAction('REPAIR', 4);
    await dispatch(0, 10);
    const res = await post(`/api/stock-actions/${rep.c.body.id}/cancel`, manager, {
      reason: 'mistake',
    });
    expect(res.status).toBe(409);
    expect(await stock(0, 'DAMAGED')).toBe(0);
    // damage can't be undone either: the usable stock is gone
    expect(
      (await post(`/api/stock-actions/${dmg.c.body.id}/cancel`, store, { reason: 'not needed' })).status,
    ).toBe(403);
    await reconciled();
  });

  it('cancelling a confirmed damage restores stock', async () => {
    await receive(0, 10);
    const dmg = await doAction('DAMAGE', 4);
    expect(
      (await post(`/api/stock-actions/${dmg.c.body.id}/cancel`, manager, { reason: 'wrong item' }))
        .status,
    ).toBe(200);
    expect(await stock(0)).toBe(10);
    expect(await stock(0, 'DAMAGED')).toBe(0);
    await reconciled();
  });

  it('backdated confirm needs a manager', async () => {
    await receive(0, 10);
    const c = await post(
      '/api/stock-actions',
      store,
      action('DAMAGE', 1, { txnDate: isoDate(-1) }),
    );
    expect((await post(`/api/stock-actions/${c.body.id}/confirm`, store)).status).toBe(403);
  });
});

const adj = (physicalQty: number, over: object = {}) => ({
  txnDate: isoDate(0),
  itemId: w.items[0]!.id,
  physicalQty,
  reason: 'cycle count',
  ...over,
});
const createAdj = (physical: number, over: object = {}, t = store) =>
  post('/api/stock-adjustments', t, adj(physical, over));

describe('stock adjustments', () => {
  it('snapshots system qty and difference; draft has no ledger effect', async () => {
    await receive(0, 10);
    const before = await ledgerCount();
    const c = await createAdj(7);
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({
      status: 'DRAFT',
      approvalStatus: 'NONE',
      systemQty: '10',
      physicalQty: '7',
      difference: '-3',
    });
    expect(c.body.adjustmentNo).toMatch(/^ADJ-\d{6}$/);
    expect(await ledgerCount()).toBe(before);
    expect(await stock(0)).toBe(10);
  });

  it('a STORE confirm only requests approval; nothing reaches the ledger', async () => {
    await receive(0, 10);
    const before = await ledgerCount();
    const c = await createAdj(7);
    const r = await post(`/api/stock-adjustments/${c.body.id}/confirm`, store);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'DRAFT', approvalStatus: 'PENDING' });
    expect((await post(`/api/stock-adjustments/${c.body.id}/confirm`, store)).status).toBe(202); // idempotent
    expect(await ledgerCount()).toBe(before);
    expect(await stock(0)).toBe(10);
    expect(await auditActions('StockAdjustment')).toEqual(['CREATE', 'REQUEST_APPROVAL']);
  });

  it('manager approval posts ADJUSTMENT_OUT for a shortfall and ADJUSTMENT_IN for a surplus', async () => {
    await receive(0, 10);
    const down = await createAdj(7);
    await post(`/api/stock-adjustments/${down.body.id}/confirm`, store);
    const ok = await post(`/api/stock-adjustments/${down.body.id}/confirm`, manager);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'CONFIRMED', approvalStatus: 'APPROVED' });
    expect(ok.body.approvedById).toBeTruthy();
    expect(await stock(0)).toBe(7);
    const t1 = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: ok.body.txnId },
    });
    expect(t1).toMatchObject({ type: 'ADJUSTMENT_OUT', referenceNo: ok.body.adjustmentNo });

    const up = await createAdj(12);
    const ok2 = await post(`/api/stock-adjustments/${up.body.id}/confirm`, manager); // manager may approve directly
    expect(ok2.status).toBe(200);
    expect(await stock(0)).toBe(12);
    expect(
      (await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: ok2.body.txnId } })).type,
    ).toBe('ADJUSTMENT_IN');
    expect(await auditActions('StockAdjustment')).toEqual([
      'CREATE',
      'REQUEST_APPROVAL',
      'CONFIRM',
      'CREATE',
      'CONFIRM',
    ]);
    await reconciled();
  });

  it('adjusts the DAMAGED bucket independently', async () => {
    await receive(0, 10);
    await doAction('DAMAGE', 4);
    const c = await createAdj(1, { stockStatus: 'DAMAGED' });
    expect(c.body.systemQty).toBe('4');
    await post(`/api/stock-adjustments/${c.body.id}/confirm`, manager);
    expect(await stock(0, 'DAMAGED')).toBe(1);
    expect(await stock(0)).toBe(6);
    await reconciled();
  });

  it('rejects a count equal to system stock, negative physical qty, and missing reason', async () => {
    await receive(0, 10);
    expect((await createAdj(10)).status).toBe(422);
    expect((await createAdj(-1)).status).toBe(400);
    expect((await createAdj(5, { reason: '  ' })).status).toBe(400);
  });

  it('refuses approval when stock moved since the count, and leaves the ledger alone', async () => {
    await receive(0, 10);
    const c = await createAdj(8);
    await dispatch(0, 2);
    const before = await ledgerCount();
    const r = await post(`/api/stock-adjustments/${c.body.id}/confirm`, manager);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/Stock changed since/);
    expect(await ledgerCount()).toBe(before);
    expect(await stock(0)).toBe(8);
  });

  it('editing a pending draft re-snapshots and withdraws the approval request', async () => {
    await receive(0, 10);
    const c = await createAdj(7);
    await post(`/api/stock-adjustments/${c.body.id}/confirm`, store);
    const e = await request(app)
      .put(`/api/stock-adjustments/${c.body.id}`)
      .set(bearer(store))
      .send(adj(6));
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ approvalStatus: 'NONE', difference: '-4' });
  });

  it('rejection = manager cancel; a confirmed adjustment can be reversed; store cannot cancel', async () => {
    await receive(0, 10);
    const c = await createAdj(7);
    await post(`/api/stock-adjustments/${c.body.id}/confirm`, store);
    expect(
      (await post(`/api/stock-adjustments/${c.body.id}/cancel`, store, { reason: 'no' })).status,
    ).toBe(403);
    const rej = await post(`/api/stock-adjustments/${c.body.id}/cancel`, manager, {
      reason: 'recount first',
    });
    expect(rej.body.status).toBe('CANCELLED');
    expect((await post(`/api/stock-adjustments/${c.body.id}/confirm`, manager)).status).toBe(409);
    expect(await stock(0)).toBe(10);

    const d = await createAdj(7, { reason: 'count 2' });
    await post(`/api/stock-adjustments/${d.body.id}/confirm`, manager);
    expect(await stock(0)).toBe(7);
    expect(
      (await post(`/api/stock-adjustments/${d.body.id}/cancel`, manager, { reason: 'wrong shelf' }))
        .status,
    ).toBe(200);
    expect(await stock(0)).toBe(10);
    await reconciled();
  });

  it('DB refuses a confirmed adjustment that was never approved', async () => {
    await receive(0, 10);
    const c = await createAdj(7);
    await expect(
      prisma.stockAdjustment.update({ where: { id: c.body.id }, data: { status: 'CONFIRMED' } }),
    ).rejects.toThrow();
  });
});
