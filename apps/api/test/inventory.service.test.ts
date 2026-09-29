import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { post, reconcile, reverse } from '../src/modules/inventory/inventory.service';
import { createUser, isoDate, resetDb, seedWorld } from './helpers';

let w: Awaited<ReturnType<typeof seedWorld>>;
let userId: string;
const today = () => isoDate(0);

beforeEach(async () => {
  await resetDb();
  w = await seedWorld(3);
  userId = (await createUser('STORE')).id;
});

const line = (i: number, direction: 'IN' | 'OUT', qty: string | number, extra = {}) => ({
  itemId: w.items[i]!.id,
  warehouseId: w.warehouse.id,
  direction,
  qty,
  ...extra,
});
const bal = async (i: number, status: 'USABLE' | 'DAMAGED' | 'INSPECTION' = 'USABLE') =>
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
const doPost = (lines: ReturnType<typeof line>[], over: object = {}) =>
  post({ type: 'PROCUREMENT', txnDate: today(), userId, lines, ...over });

describe('InventoryService.post', () => {
  it('updates ledger + cache atomically, writes audit, and reconciles', async () => {
    const t = await doPost([line(0, 'IN', 50), line(1, 'IN', '2.5')]);
    expect(t.txnNo).toMatch(/^TXN-\d{8}$/);
    expect(await bal(0)).toBe(50);
    expect(await bal(1)).toBe(2.5);
    await doPost([line(0, 'OUT', 10)], { type: 'DISPATCH' });
    expect(await bal(0)).toBe(40);
    expect(
      await prisma.auditLog.count({ where: { entity: 'InventoryTransaction', action: 'POST' } }),
    ).toBe(2);
    expect((await reconcile()).ok).toBe(true);
  });

  it('blocks negative stock and leaves no trace', async () => {
    await doPost([line(0, 'IN', 5)]);
    const before = await prisma.inventoryTransaction.count();
    await expect(doPost([line(0, 'OUT', 5.001)], { type: 'DISPATCH' })).rejects.toMatchObject({
      status: 409,
      details: { shortages: [{ available: '5.000', requested: '5.001' }] },
    });
    expect(await bal(0)).toBe(5);
    expect(await prisma.inventoryTransaction.count()).toBe(before);
    await doPost([line(0, 'OUT', 5)], { type: 'DISPATCH' }); // exact balance is fine
    expect(await bal(0)).toBe(0);
  });

  it('one short line rejects the whole multi-line transaction', async () => {
    await doPost([line(0, 'IN', 10), line(1, 'IN', 1)]);
    await expect(
      doPost([line(0, 'OUT', 4), line(1, 'OUT', 2)], { type: 'DISPATCH' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await bal(0)).toBe(10); // first line was NOT applied
    expect((await reconcile()).ok).toBe(true);
  });

  it('only USABLE stock is available; buckets are independent', async () => {
    await doPost([line(0, 'IN', 5, { stockStatus: 'DAMAGED' })]);
    await expect(doPost([line(0, 'OUT', 1)], { type: 'DISPATCH' })).rejects.toMatchObject({
      status: 409,
    });
    expect(await bal(0, 'DAMAGED')).toBe(5);
  });

  it('rejects zero, negative, over-precise quantities, inactive items, future dates', async () => {
    for (const q of [0, -1, '0.0004', '1.2345', 'abc']) {
      await expect(doPost([line(0, 'IN', q)])).rejects.toMatchObject({ status: 400 });
    }
    await expect(doPost([line(0, 'IN', 1)], { txnDate: isoDate(2) })).rejects.toMatchObject({
      status: 400,
    });
    await prisma.item.update({ where: { id: w.items[0]!.id }, data: { active: false } });
    await expect(doPost([line(0, 'IN', 1)])).rejects.toMatchObject({ status: 422 });
    await expect(doPost([])).rejects.toMatchObject({ status: 400 });
  });

  it('is idempotent on idempotencyKey (sequential and racing)', async () => {
    const a = await doPost([line(0, 'IN', 7)], { idempotencyKey: 'k1' });
    const b = await doPost([line(0, 'IN', 7)], { idempotencyKey: 'k1' });
    expect(b.id).toBe(a.id);
    expect(await bal(0)).toBe(7);
    const racers = await Promise.all(
      Array.from({ length: 5 }, () => doPost([line(1, 'IN', 3)], { idempotencyKey: 'k2' })),
    );
    expect(new Set(racers.map((r) => r.id)).size).toBe(1);
    expect(await bal(1)).toBe(3);
  });

  it('concurrent outward posts never oversell (row locking)', async () => {
    await doPost([line(0, 'IN', 10)]);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => doPost([line(0, 'OUT', 3)], { type: 'DISPATCH' })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(3);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .every((r) => (r as PromiseRejectedResult).reason.status === 409),
    ).toBe(true);
    expect(await bal(0)).toBe(1);
    expect((await reconcile()).ok).toBe(true);
  });

  it('opposite-order multi-line posts do not deadlock', async () => {
    await doPost([line(0, 'IN', 100), line(1, 'IN', 100)]);
    const jobs = Array.from({ length: 8 }, (_, i) =>
      doPost(
        i % 2 ? [line(0, 'OUT', 1), line(1, 'OUT', 1)] : [line(1, 'OUT', 1), line(0, 'OUT', 1)],
        { type: 'DISPATCH' },
      ),
    );
    await Promise.all(jobs);
    expect(await bal(0)).toBe(92);
    expect(await bal(1)).toBe(92);
  });

  it('backdated outward cannot create negative stock on an earlier date', async () => {
    await doPost([line(0, 'IN', 10)], { txnDate: isoDate(-5) });
    await doPost([line(0, 'IN', 10)], { txnDate: isoDate(-1) });
    // 15 out on day -3 is impossible: only 10 were in stock then, even though 20 are now.
    await expect(
      doPost([line(0, 'OUT', 15)], { type: 'DISPATCH', txnDate: isoDate(-3) }),
    ).rejects.toMatchObject({
      status: 409,
    });
    await doPost([line(0, 'OUT', 10)], { type: 'DISPATCH', txnDate: isoDate(-3) });
    expect(await bal(0)).toBe(10);
    // ...and now a backdated out that breaks the LATER balance (day -1 has 10, minus more) is refused too
    await expect(
      doPost([line(0, 'OUT', 11)], { type: 'DISPATCH', txnDate: isoDate(-4) }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('database guarantees (service bypassed)', () => {
  it('rejects negative cached balances', async () => {
    await doPost([line(0, 'IN', 1)]);
    await expect(prisma.$executeRawUnsafe('UPDATE stock_balances SET qty = -1')).rejects.toThrow();
  });
  it('ledger rows are append-only', async () => {
    const t = await doPost([line(0, 'IN', 1)]);
    await expect(
      prisma.inventoryTransaction.update({ where: { id: t.id }, data: { remarks: 'x' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.inventoryTransaction.delete({ where: { id: t.id } })).rejects.toThrow();
    await expect(prisma.inventoryTransactionItem.deleteMany()).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe('UPDATE inventory_transaction_items SET qty_in = 999'),
    ).rejects.toThrow(/append-only/);
  });
  it('rejects lines with both or neither direction', async () => {
    const t = await doPost([line(0, 'IN', 1)]);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO inventory_transaction_items (id, txn_id, line_no, item_id, warehouse_id, qty_in, qty_out) VALUES (gen_random_uuid(), '${t.id}', 9, '${w.items[0]!.id}', '${w.warehouse.id}', 1, 1)`,
      ),
    ).rejects.toThrow();
  });
});

describe('InventoryService.reverse', () => {
  it('appends a linked REVERSAL restoring the balance; original untouched', async () => {
    const t = await doPost([line(0, 'IN', 20), line(1, 'IN', 4)]);
    const r = await reverse(t.id, 'entered twice', userId);
    expect(r.type).toBe('REVERSAL');
    expect(r.reversesTxnId).toBe(t.id);
    expect(r.remarks).toContain(t.txnNo);
    expect(await bal(0)).toBe(0);
    expect(await bal(1)).toBe(0);
    const orig = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: t.id },
      include: { lines: true },
    });
    expect(orig.type).toBe('PROCUREMENT');
    expect(orig.lines).toHaveLength(2);
    expect((await reconcile()).ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'REVERSE' } })).toBe(1);
  });

  it('cannot be reversed twice, and a reversal cannot be reversed', async () => {
    const t = await doPost([line(0, 'IN', 5)]);
    const r = await reverse(t.id, 'oops', userId);
    await expect(reverse(t.id, 'again', userId)).rejects.toMatchObject({ status: 409 });
    await expect(reverse(r.id, 'undo', userId)).rejects.toMatchObject({ status: 409 });
    // racing reversals: exactly one wins
    const t2 = await doPost([line(0, 'IN', 5)]);
    const res = await Promise.allSettled([
      reverse(t2.id, 'a', userId),
      reverse(t2.id, 'b', userId),
    ]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await bal(0)).toBe(0);
  });

  it('is refused when stock was already consumed (would go negative)', async () => {
    const t = await doPost([line(0, 'IN', 10)]);
    await doPost([line(0, 'OUT', 8)], { type: 'DISPATCH' });
    await expect(reverse(t.id, 'mistake', userId)).rejects.toMatchObject({ status: 409 });
    expect(await bal(0)).toBe(2);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'REVERSAL' } })).toBe(0);
  });

  it('works for items that were deactivated afterwards', async () => {
    const t = await doPost([line(0, 'IN', 3)]);
    await prisma.item.update({ where: { id: w.items[0]!.id }, data: { active: false } });
    await reverse(t.id, 'cleanup', userId);
    expect(await bal(0)).toBe(0);
  });
});

describe('reconcile', () => {
  it('detects a deliberately corrupted cache, a missing row, and a phantom row', async () => {
    await doPost([line(0, 'IN', 10), line(1, 'IN', 5)]);
    expect((await reconcile()).ok).toBe(true);

    await prisma.$executeRaw`UPDATE stock_balances SET qty = 99 WHERE item_id = ${w.items[0]!.id}::uuid`;
    await prisma.$executeRaw`DELETE FROM stock_balances WHERE item_id = ${w.items[1]!.id}::uuid`;
    await prisma.stockBalance.create({
      data: { itemId: w.items[2]!.id, warehouseId: w.warehouse.id, stockStatus: 'USABLE', qty: 7 },
    });
    const r = await reconcile();
    expect(r.ok).toBe(false);
    expect(r.mismatches).toHaveLength(3);
    expect(r.mismatches).toContainEqual(
      expect.objectContaining({ itemId: w.items[0]!.id, ledgerQty: '10.000', cachedQty: '99.000' }),
    );
    expect(r.mismatches).toContainEqual(
      expect.objectContaining({ itemId: w.items[1]!.id, ledgerQty: '5.000', cachedQty: '0.000' }),
    );
    expect(r.mismatches).toContainEqual(
      expect.objectContaining({ itemId: w.items[2]!.id, ledgerQty: '0.000', cachedQty: '7.000' }),
    );
  });
});
