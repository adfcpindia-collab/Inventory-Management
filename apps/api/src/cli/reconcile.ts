import { prisma } from '../lib/prisma';
import { reconcile } from '../modules/inventory/inventory.service';

/** `npm run inventory:reconcile` — exits 1 when the balance cache disagrees with the ledger. */
async function main() {
  const r = await reconcile();
  console.log(`Checked ${r.balancesChecked} balances at ${r.checkedAt}`);
  if (r.ok) {
    console.log('OK: zero mismatches');
    return;
  }
  console.error(`MISMATCHES: ${r.mismatches.length}`);
  for (const m of r.mismatches) {
    console.error(
      `  item=${m.itemId} wh=${m.warehouseId} ${m.stockStatus}: ledger=${m.ledgerQty} cached=${m.cachedQty}`,
    );
  }
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
