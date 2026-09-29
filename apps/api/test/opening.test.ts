import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { prisma } from '../src/lib/prisma';
import { post } from '../src/modules/inventory/inventory.service';
import { app, bearer, isoDate, resetDb, seedWorld, tokenFor } from './helpers';

let w: Awaited<ReturnType<typeof seedWorld>>;
beforeEach(async () => {
  await resetDb();
  w = await seedWorld(3);
});

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const manual = (over: object = {}) => ({
  txnDate: isoDate(-30),
  lines: [{ itemId: w.items[0]!.id, qty: 50 }],
  ...over,
});

async function workbook(
  rows: (string | number | null)[][],
  headers = ['Item Code', 'Warehouse Code', 'Quantity', 'Unit', 'Unit Cost', 'Batch No'],
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const upload = (path: string, token: string, buf: Buffer, date = isoDate(-30)) =>
  request(app)
    .post(`/api/opening-stock/import/${path}?date=${date}`)
    .set(bearer(token))
    .set('Content-Type', XLSX)
    .send(buf);
const stock = async (i: number) =>
  Number((await prisma.stockBalance.findFirst({ where: { itemId: w.items[i]!.id } }))?.qty ?? 0);

describe('manual opening stock', () => {
  it('creates an OPENING_STOCK transaction in the default warehouse and updates balances', async () => {
    const t = await tokenFor('MANAGER');
    const res = await request(app)
      .post('/api/opening-stock')
      .set(bearer(t))
      .send(
        manual({
          lines: [
            { itemId: w.items[0]!.id, qty: 50, unitCost: 100, batchNo: 'B1' },
            { itemId: w.items[1]!.id, qty: '2.5' },
          ],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.lines).toHaveLength(2);
    expect(await stock(0)).toBe(50);
    expect(await stock(1)).toBe(2.5);
    const txn = await prisma.inventoryTransaction.findFirstOrThrow({ include: { lines: true } });
    expect(txn.type).toBe('OPENING_STOCK');
    expect(txn.lines[0]!.warehouseId).toBe(w.warehouse.id);
    expect(txn.lines[0]!.batchNo).toBe('B1');
  });

  it('is restricted to ADMIN/MANAGER', async () => {
    for (const role of ['STORE', 'VIEWER'] as const) {
      const res = await request(app)
        .post('/api/opening-stock')
        .set(bearer(await tokenFor(role)))
        .send(manual());
      expect(res.status).toBe(403);
    }
  });

  it('never overwrites: duplicate opening for the same item/warehouse is rejected', async () => {
    const t = await tokenFor('MANAGER');
    expect(
      (await request(app).post('/api/opening-stock').set(bearer(t)).send(manual())).status,
    ).toBe(201);
    const dup = await request(app)
      .post('/api/opening-stock')
      .set(bearer(t))
      .send(manual({ lines: [{ itemId: w.items[0]!.id, qty: 5 }] }));
    expect(dup.status).toBe(409);
    expect(await stock(0)).toBe(50);
    // same item twice within one request
    const twice = await request(app)
      .post('/api/opening-stock')
      .set(bearer(t))
      .send(
        manual({
          lines: [
            { itemId: w.items[1]!.id, qty: 1 },
            { itemId: w.items[1]!.id, qty: 2 },
          ],
        }),
      );
    expect(twice.status).toBe(422);
    expect(await stock(1)).toBe(0);
  });

  it('validates input: zero/negative qty, bad date, future date, unknown item, inactive item', async () => {
    const t = await tokenFor('ADMIN');
    const send = (b: object) => request(app).post('/api/opening-stock').set(bearer(t)).send(b);
    expect((await send(manual({ lines: [{ itemId: w.items[0]!.id, qty: 0 }] }))).status).toBe(400);
    expect((await send(manual({ lines: [{ itemId: w.items[0]!.id, qty: -3 }] }))).status).toBe(400);
    expect((await send(manual({ txnDate: '30-01-2025' }))).status).toBe(400);
    expect((await send(manual({ txnDate: isoDate(3) }))).status).toBe(400);
    expect((await send(manual({ lines: [] }))).status).toBe(400);
    expect(
      (await send(manual({ lines: [{ itemId: '00000000-0000-4000-8000-000000000000', qty: 1 }] })))
        .status,
    ).toBe(422);
    await prisma.item.update({ where: { id: w.items[0]!.id }, data: { active: false } });
    expect((await send(manual())).status).toBe(422);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it('double-submit with the same Idempotency-Key creates one transaction', async () => {
    const t = await tokenFor('MANAGER');
    const go = () =>
      request(app)
        .post('/api/opening-stock')
        .set(bearer(t))
        .set('Idempotency-Key', 'abc-1')
        .send(manual());
    const [a, b] = [await go(), await go()];
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.inventoryTransaction.count()).toBe(1);
  });

  it('concurrent duplicate openings: exactly one wins', async () => {
    const t = await tokenFor('MANAGER');
    const res = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).post('/api/opening-stock').set(bearer(t)).send(manual()),
      ),
    );
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stock(0)).toBe(50);
  });

  it('can be reversed, then re-entered; reversal blocked once stock is consumed', async () => {
    const t = await tokenFor('MANAGER');
    const first = await request(app).post('/api/opening-stock').set(bearer(t)).send(manual());
    const rev = await request(app)
      .post(`/api/opening-stock/${first.body.id}/reverse`)
      .set(bearer(t))
      .send({ reason: 'wrong qty' });
    expect(rev.status).toBe(201);
    expect(await stock(0)).toBe(0);
    expect(
      (
        await request(app)
          .post(`/api/opening-stock/${first.body.id}/reverse`)
          .set(bearer(t))
          .send({ reason: 'again' })
      ).status,
    ).toBe(409);
    const again = await request(app)
      .post('/api/opening-stock')
      .set(bearer(t))
      .send(manual({ lines: [{ itemId: w.items[0]!.id, qty: 40 }] }));
    expect(again.status).toBe(201);
    await post({
      type: 'DISPATCH',
      txnDate: isoDate(0),
      userId: (await prisma.user.findFirstOrThrow()).id,
      lines: [{ itemId: w.items[0]!.id, warehouseId: w.warehouse.id, direction: 'OUT', qty: 30 }],
    });
    const blocked = await request(app)
      .post(`/api/opening-stock/${again.body.id}/reverse`)
      .set(bearer(t))
      .send({ reason: 'nope' });
    expect(blocked.status).toBe(409);
    expect(await stock(0)).toBe(10);
    expect((await request(app).get('/api/inventory/reconcile').set(bearer(t))).body.ok).toBe(true);
  });

  it('reversal endpoint refuses non-opening transactions and requires a reason', async () => {
    const t = await tokenFor('ADMIN');
    const user = await prisma.user.findFirstOrThrow();
    const proc = await post({
      type: 'PROCUREMENT',
      txnDate: isoDate(0),
      userId: user.id,
      lines: [{ itemId: w.items[0]!.id, warehouseId: w.warehouse.id, direction: 'IN', qty: 5 }],
    });
    expect(
      (
        await request(app)
          .post(`/api/opening-stock/${proc.id}/reverse`)
          .set(bearer(t))
          .send({ reason: 'x y z' })
      ).status,
    ).toBe(409);
    const open = await request(app).post('/api/opening-stock').set(bearer(t)).send(manual());
    expect(
      (
        await request(app)
          .post(`/api/opening-stock/${open.body.id}/reverse`)
          .set(bearer(t))
          .send({})
      ).status,
    ).toBe(400);
  });
});

describe('excel import', () => {
  it('serves a template that has the expected headers', async () => {
    const res = await request(app)
      .get('/api/opening-stock/template')
      .set(bearer(await tokenFor('VIEWER')))
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.getWorksheet('Opening Stock')!.getRow(1).values).toEqual([
      undefined,
      'Item Code',
      'Warehouse Code',
      'Quantity',
      'Unit',
      'Unit Cost',
      'Batch No',
    ]);
  });

  it('preview reports every row error and confirm refuses to save anything', async () => {
    const t = await tokenFor('MANAGER');
    const buf = await workbook([
      ['item-1', null, 10, 'KG', 5, 'B1'], // ok (code case-insensitive)
      ['NOPE', null, 5, null, null, null], // unknown item
      ['ITEM-2', 'ZZZ', 5, null, null, null], // unknown warehouse
      ['ITEM-3', null, 0, null, null, null], // zero qty
      ['ITEM-3', null, 1.2345, null, null, null], // precision
      ['ITEM-2', null, 4, 'NOS', null, null], // wrong unit
      ['ITEM-1', null, 3, null, null, null], // duplicate of row 2
      [null, null, 9, null, null, null], // missing code
    ]);
    const pre = await upload('preview', t, buf);
    expect(pre.status).toBe(200);
    expect(pre.body).toMatchObject({ validCount: 1, errorCount: 7, canConfirm: false });
    const errs = (row: number) =>
      pre.body.rows.find((r: { row: number }) => r.row === row).errors.join('|');
    expect(errs(2)).toBe('');
    expect(errs(3)).toMatch(/not found/);
    expect(errs(4)).toMatch(/Warehouse "ZZZ" not found/);
    expect(errs(5)).toMatch(/greater than 0/);
    expect(errs(6)).toMatch(/3 decimal/);
    expect(errs(7)).toMatch(/does not match item unit KG/);
    expect(errs(8)).toMatch(/Duplicate of row 2/);
    expect(errs(9)).toMatch(/Item code is required/);
    expect(await prisma.inventoryTransaction.count()).toBe(0); // preview writes nothing

    const conf = await upload('confirm', t, buf);
    expect(conf.status).toBe(422);
    expect(conf.body.error.code).toBe('IMPORT_INVALID');
    expect(conf.body.error.details.errorCount).toBe(7);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
    expect(await stock(0)).toBe(0);
  });

  it('confirm creates one OPENING_STOCK transaction; repeating the same upload is idempotent', async () => {
    const t = await tokenFor('MANAGER');
    const buf = await workbook([
      ['ITEM-1', null, 12.5, 'KG', 10, 'B7'],
      ['ITEM-2', 'main', 3, null, null, null],
    ]);
    const pre = await upload('preview', t, buf);
    expect(pre.body.canConfirm).toBe(true);
    const a = await upload('confirm', t, buf);
    expect(a.status).toBe(201);
    expect(await stock(0)).toBe(12.5);
    expect(await stock(1)).toBe(3);
    expect(await prisma.inventoryTransaction.count()).toBe(1);
    const b = await upload('confirm', t, buf); // double-click / retry
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await stock(0)).toBe(12.5);
    // a fresh preview of the same file now flags existing opening stock
    const again = await upload('preview', t, buf);
    expect(again.body.errorCount).toBe(2);
    expect(again.body.rows[0].errors[0]).toMatch(/already exists/);
  });

  it('rejects garbage uploads, missing columns, empty sheets, and non-managers', async () => {
    const t = await tokenFor('MANAGER');
    expect((await upload('preview', t, Buffer.from('not an excel file'))).status).toBe(422);
    expect((await upload('preview', t, await workbook([['a', 1]], ['Foo', 'Bar']))).status).toBe(
      422,
    );
    expect((await upload('preview', t, await workbook([]))).status).toBe(422);
    expect(
      (
        await upload(
          'preview',
          await tokenFor('STORE'),
          await workbook([['ITEM-1', null, 1, null, null, null]]),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/opening-stock/import/preview?date=bad`)
          .set(bearer(t))
          .set('Content-Type', XLSX)
          .send(Buffer.from('x'))
      ).status,
    ).toBe(400);
  });
});

describe('ledger view', () => {
  it('shows date, type, reference, opening, in, out, balance, user and remarks with a correct running balance', async () => {
    const t = await tokenFor('MANAGER');
    const user = await prisma.user.findFirstOrThrow();
    const client = await prisma.client.create({ data: { companyName: 'Acme' } });
    const supplier = await prisma.supplier.create({ data: { companyName: 'Sup' } });
    const item = w.items[0]!;
    const L = (direction: 'IN' | 'OUT', qty: number) => [
      { itemId: item.id, warehouseId: w.warehouse.id, direction, qty },
    ];
    await post({
      type: 'OPENING_STOCK',
      txnDate: isoDate(-10),
      userId: user.id,
      lines: L('IN', 50),
      remarks: 'start',
    });
    await post({
      type: 'PROCUREMENT',
      txnDate: isoDate(-5),
      userId: user.id,
      supplierId: supplier.id,
      referenceNo: 'GRN-1',
      lines: L('IN', 20),
    });
    await post({
      type: 'DISPATCH',
      txnDate: isoDate(-2),
      userId: user.id,
      clientId: client.id,
      referenceNo: 'CH-100',
      lines: L('OUT', 10),
    });

    const all = await request(app).get(`/api/inventory/ledger?itemId=${item.id}`).set(bearer(t));
    expect(all.body.total).toBe(3);
    expect(all.body.data.map((r: { type: string }) => r.type)).toEqual([
      'OPENING_STOCK',
      'PROCUREMENT',
      'DISPATCH',
    ]);
    expect(all.body.data.map((r: { opening: string }) => r.opening)).toEqual([
      '0.000',
      '50.000',
      '70.000',
    ]);
    expect(all.body.data.map((r: { balance: string }) => r.balance)).toEqual([
      '50.000',
      '70.000',
      '60.000',
    ]);
    expect(all.body.data[2]).toMatchObject({
      reference: 'CH-100',
      in: '0.000',
      out: '10.000',
      user: 'MANAGER user',
      date: isoDate(-2),
    });
    expect(all.body.data[0].remarks).toBe('start');

    // filters change what's shown, never the running balance
    const byDate = await request(app)
      .get(`/api/inventory/ledger?itemId=${item.id}&from=${isoDate(-3)}`)
      .set(bearer(t));
    expect(byDate.body.data).toHaveLength(1);
    expect(byDate.body.data[0]).toMatchObject({ opening: '70.000', balance: '60.000' });
    const q = (s: string) =>
      request(app)
        .get(`/api/inventory/ledger?itemId=${item.id}&${s}`)
        .set(bearer(t))
        .then((r) => r.body.data.length);
    expect(await q('type=DISPATCH')).toBe(1);
    expect(await q(`clientId=${client.id}`)).toBe(1);
    expect(await q(`supplierId=${supplier.id}`)).toBe(1);
    expect(await q('reference=grn')).toBe(1);
    expect(await q(`userId=${user.id}`)).toBe(3);
    expect(await q(`from=${isoDate(-6)}&to=${isoDate(-4)}`)).toBe(1);
    expect(await q('stockStatus=DAMAGED')).toBe(0);
    expect(await q('pageSize=2')).toBe(2);

    expect(
      (await request(app).get('/api/inventory/ledger?itemId=nope').set(bearer(t))).status,
    ).toBe(400);
    expect((await request(app).get('/api/inventory/ledger')).status).toBe(401);
  });

  it('keeps a separate running balance per item, and reconcile is role-gated', async () => {
    const t = await tokenFor('MANAGER');
    const user = await prisma.user.findFirstOrThrow();
    await post({
      type: 'OPENING_STOCK',
      txnDate: isoDate(-1),
      userId: user.id,
      lines: [
        { itemId: w.items[0]!.id, warehouseId: w.warehouse.id, direction: 'IN', qty: 5 },
        { itemId: w.items[1]!.id, warehouseId: w.warehouse.id, direction: 'IN', qty: 9 },
      ],
    });
    const res = await request(app).get('/api/inventory/ledger').set(bearer(t));
    expect(res.body.data.map((r: { balance: string }) => r.balance).sort()).toEqual([
      '5.000',
      '9.000',
    ]);
    expect(
      (
        await request(app)
          .get('/api/inventory/reconcile')
          .set(bearer(await tokenFor('STORE')))
      ).status,
    ).toBe(403);
    const bal = await request(app)
      .get('/api/inventory/balances')
      .set(bearer(await tokenFor('VIEWER')));
    expect(bal.body).toHaveLength(2);
  });
});
