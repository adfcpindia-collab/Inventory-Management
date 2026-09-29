import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { ImportPreview, ImportRowResult, OpeningStockInput } from '@inventory/shared';
import { openingStockLineSchema } from '@inventory/shared';
import { conflict, unprocessable } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { post, type PostLine } from '../inventory/inventory.service';

interface ResolvedLine {
  itemId: string;
  warehouseId: string;
  qty: number;
  unitCost?: number;
  batchNo?: string;
}

async function defaultWarehouseId(tx: Tx | typeof prisma = prisma) {
  const w = await tx.warehouse.findFirst({ where: { isDefault: true, active: true } });
  if (!w) throw unprocessable('No default warehouse configured');
  return w.id;
}

/**
 * Opening stock never overwrites: an (item, warehouse) that already has a non-reversed opening
 * entry is rejected. Correct it by reversing the entry, or with a stock adjustment.
 */
async function findExistingOpenings(
  tx: Tx | typeof prisma,
  pairs: { itemId: string; warehouseId: string }[],
) {
  if (pairs.length === 0) return new Set<string>();
  const rows = await tx.inventoryTransactionItem.findMany({
    where: {
      txn: { type: 'OPENING_STOCK', reversedBy: null },
      OR: pairs.map((p) => ({ itemId: p.itemId, warehouseId: p.warehouseId })),
    },
    select: { itemId: true, warehouseId: true },
  });
  return new Set(rows.map((r) => `${r.itemId}|${r.warehouseId}`));
}

export async function createOpeningStock(
  input: OpeningStockInput,
  userId: string,
  idempotencyKey?: string,
) {
  return prisma.$transaction(async (tx) => {
    if (idempotencyKey) {
      const prior = await tx.inventoryTransaction.findUnique({
        where: { idempotencyKey },
        include: { lines: true },
      });
      if (prior) return prior;
    }
    const wh = await defaultWarehouseId(tx);
    const lines: ResolvedLine[] = input.lines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId ?? wh,
      qty: l.qty,
      unitCost: l.unitCost,
      batchNo: l.batchNo,
    }));

    const seen = new Set<string>();
    for (const l of lines) {
      const k = `${l.itemId}|${l.warehouseId}`;
      if (seen.has(k)) throw unprocessable('Duplicate item/warehouse in the same opening entry');
      seen.add(k);
    }
    // Serialise concurrent openings for the same buckets so the duplicate check cannot race.
    for (const k of [...seen].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'opening:' + k}))`;
    }
    const existing = await findExistingOpenings(tx, lines);
    if (existing.size) {
      throw conflict(
        'Opening stock already exists for one or more item/warehouse pairs. Reverse it or use a stock adjustment.',
        { pairs: [...existing] },
      );
    }
    const postLines: PostLine[] = lines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      direction: 'IN',
      qty: l.qty,
      unitCost: l.unitCost,
      batchNo: l.batchNo,
    }));
    return post(
      {
        type: 'OPENING_STOCK',
        txnDate: input.txnDate,
        userId,
        remarks: input.remarks,
        idempotencyKey,
        lines: postLines,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------- Excel import

const HEADERS = [
  'Item Code',
  'Warehouse Code',
  'Quantity',
  'Unit',
  'Unit Cost',
  'Batch No',
] as const;
const MAX_ROWS = 2000;

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Opening Stock');
  ws.addRow([...HEADERS]);
  ws.addRow(['ABC-9KG', '', 50, 'KG', 100, '']);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE3F0' } };
  ws.columns = HEADERS.map((h) => ({ width: Math.max(14, h.length + 4) }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const help = wb.addWorksheet('Instructions');
  [
    ['Column', 'Notes'],
    ['Item Code', 'Required. Must match an active item.'],
    ['Warehouse Code', 'Optional. Blank = default warehouse.'],
    ['Quantity', 'Required. Greater than 0, up to 3 decimals.'],
    ['Unit', "Optional. If given, must match the item's unit."],
    ['Unit Cost', 'Optional. Up to 2 decimals.'],
    ['Batch No', 'Optional.'],
    ['', 'The opening date is chosen on screen. Existing opening stock is never overwritten.'],
    ['', 'Delete the sample row before uploading.'],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 18;
  help.getColumn(2).width = 80;
  help.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
    if (v instanceof Date) return v.toISOString();
    return '';
  }
  return String(v).trim();
}

export interface ParsedImport {
  preview: ImportPreview;
  lines: ResolvedLine[];
  fileHash: string;
}

/** Parses and fully validates an opening-stock workbook without writing anything. */
export async function parseOpeningWorkbook(buf: Buffer): Promise<ParsedImport> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw unprocessable('File is not a valid .xlsx workbook');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw unprocessable('Workbook has no sheets');

  const headerRow = ws.getRow(1);
  const col: Record<string, number> = {};
  headerRow.eachCell((c, n) => {
    col[cellText(c.value).toLowerCase()] = n;
  });
  const missing = ['item code', 'quantity'].filter((h) => !col[h]);
  if (missing.length) throw unprocessable(`Missing required column(s): ${missing.join(', ')}`);
  const get = (row: ExcelJS.Row, h: string) => (col[h] ? cellText(row.getCell(col[h]).value) : '');

  const raw: {
    row: number;
    itemCode: string;
    whCode: string;
    qty: string;
    unit: string;
    cost: string;
    batch: string;
  }[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r = {
      row: n,
      itemCode: get(row, 'item code'),
      whCode: get(row, 'warehouse code'),
      qty: get(row, 'quantity'),
      unit: get(row, 'unit'),
      cost: get(row, 'unit cost'),
      batch: get(row, 'batch no'),
    };
    if (Object.entries(r).some(([k, v]) => k !== 'row' && v !== '')) raw.push(r);
  });
  if (raw.length === 0) throw unprocessable('No data rows found');
  if (raw.length > MAX_ROWS) throw unprocessable(`Too many rows (max ${MAX_ROWS})`);

  const items = await prisma.item.findMany({
    where: { code: { in: raw.map((r) => r.itemCode.toUpperCase()).filter(Boolean) } },
    include: { unit: true },
  });
  const itemByCode = new Map(items.map((i) => [i.code, i]));
  const warehouses = await prisma.warehouse.findMany();
  const whByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w]));
  const defaultWh = warehouses.find((w) => w.isDefault && w.active);

  const results: ImportRowResult[] = [];
  const lines: ResolvedLine[] = [];
  const seen = new Map<string, number>();
  const candidates: { idx: number; itemId: string; warehouseId: string }[] = [];

  for (const r of raw) {
    const errors: string[] = [];
    const res: ImportRowResult = { row: r.row, itemCode: r.itemCode, errors };
    const item = itemByCode.get(r.itemCode.toUpperCase());
    if (!r.itemCode) errors.push('Item code is required');
    else if (!item) errors.push(`Item "${r.itemCode}" not found`);
    else {
      res.itemName = item.name;
      if (!item.active) errors.push(`Item ${item.code} is inactive`);
      if (r.unit && r.unit.toUpperCase() !== item.unit.code) {
        errors.push(`Unit ${r.unit.toUpperCase()} does not match item unit ${item.unit.code}`);
      }
    }
    let wh = defaultWh;
    if (r.whCode) {
      wh = whByCode.get(r.whCode.toUpperCase());
      res.warehouseCode = r.whCode.toUpperCase();
      if (!wh) errors.push(`Warehouse "${r.whCode}" not found`);
      else if (!wh.active) errors.push(`Warehouse ${wh.code} is inactive`);
    } else if (!wh) errors.push('No default warehouse configured');
    else res.warehouseCode = wh.code;

    const parsed = openingStockLineSchema.shape.qty.safeParse(r.qty === '' ? undefined : r.qty);
    if (!parsed.success) errors.push(`Quantity: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    else res.qty = parsed.data;
    if (r.cost !== '') {
      const c = openingStockLineSchema.shape.unitCost.safeParse(r.cost);
      if (!c.success) errors.push(`Unit cost: ${c.error.issues[0]?.message ?? 'invalid'}`);
      else res.unitCost = c.data;
    }
    if (r.batch) res.batchNo = r.batch.slice(0, 50);

    if (item && wh) {
      const k = `${item.id}|${wh.id}`;
      if (seen.has(k)) errors.push(`Duplicate of row ${seen.get(k)} (same item and warehouse)`);
      else seen.set(k, r.row);
      candidates.push({ idx: results.length, itemId: item.id, warehouseId: wh.id });
      if (!errors.length) {
        lines.push({
          itemId: item.id,
          warehouseId: wh.id,
          qty: res.qty!,
          unitCost: res.unitCost,
          batchNo: res.batchNo,
        });
      }
    }
    results.push(res);
  }

  const existing = await findExistingOpenings(prisma, candidates);
  for (const c of candidates) {
    if (existing.has(`${c.itemId}|${c.warehouseId}`)) {
      results[c.idx]!.errors.push('Opening stock already exists for this item/warehouse');
    }
  }
  const errorCount = results.filter((r) => r.errors.length).length;
  return {
    preview: {
      rows: results,
      validCount: results.length - errorCount,
      errorCount,
      canConfirm: errorCount === 0,
    },
    lines: errorCount === 0 ? lines : [],
    fileHash: createHash('sha256').update(buf).digest('hex'),
  };
}
