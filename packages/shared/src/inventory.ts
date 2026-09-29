import { z } from 'zod';
import { emptyToUndef, optionalText } from './common';

export const TXN_TYPES = [
  'OPENING_STOCK',
  'PROCUREMENT',
  'DISPATCH',
  'CUSTOMER_RETURN',
  'SUPPLIER_RETURN',
  'CONVERSION_IN',
  'CONVERSION_OUT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'SCRAP',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'REVERSAL',
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const STOCK_STATUSES = ['USABLE', 'DAMAGED', 'INSPECTION'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/** YYYY-MM-DD business date. */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Invalid date');

/** Strictly positive quantity, max 3 decimals (matches NUMERIC(18,3)). */
export const positiveQty = z.coerce
  .number({ invalid_type_error: 'Quantity must be a number' })
  .finite()
  .gt(0, 'Quantity must be greater than 0')
  .max(999_999_999_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Max 3 decimal places');

const unitCost = z.preprocess(
  emptyToUndef,
  z.coerce
    .number()
    .finite()
    .min(0)
    .max(9_999_999_999_999)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Max 2 decimal places')
    .optional(),
);

export const openingStockLineSchema = z.object({
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  qty: positiveQty,
  unitCost,
  batchNo: optionalText(50),
});

export const openingStockSchema = z.object({
  txnDate: dateString,
  remarks: optionalText(500),
  lines: z.array(openingStockLineSchema).min(1, 'Add at least one line').max(500),
});
export type OpeningStockInput = z.infer<typeof openingStockSchema>;

export const reverseSchema = z.object({
  reason: z.string().trim().min(3, 'Reason is required').max(500),
});

const optUuid = z.preprocess(emptyToUndef, z.string().uuid().optional());

export const ledgerQuery = z.object({
  itemId: optUuid,
  warehouseId: optUuid,
  /** Ledger is per stock bucket; defaults to usable stock. */
  stockStatus: z.enum([...STOCK_STATUSES, 'ALL']).default('USABLE'),
  from: z.preprocess(emptyToUndef, dateString.optional()),
  to: z.preprocess(emptyToUndef, dateString.optional()),
  type: z.preprocess(emptyToUndef, z.enum(TXN_TYPES).optional()),
  clientId: optUuid,
  supplierId: optUuid,
  userId: optUuid,
  /** Matches reference number (challan / GRN / ...) or transaction number. */
  reference: z.preprocess(emptyToUndef, z.string().trim().max(100).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type LedgerQuery = z.infer<typeof ledgerQuery>;

export interface LedgerRow {
  lineId: string;
  txnId: string;
  txnNo: string;
  date: string;
  type: TxnType;
  reference: string;
  itemId: string;
  warehouseId: string;
  stockStatus: StockStatus;
  opening: string;
  in: string;
  out: string;
  balance: string;
  user: string;
  remarks: string | null;
}

export interface ReconcileMismatch {
  itemId: string;
  warehouseId: string;
  stockStatus: StockStatus;
  ledgerQty: string;
  cachedQty: string;
}
export interface ReconcileResult {
  checkedAt: string;
  balancesChecked: number;
  ok: boolean;
  mismatches: ReconcileMismatch[];
}

export interface ImportRowResult {
  row: number;
  itemCode: string;
  itemName?: string;
  warehouseCode?: string;
  qty?: number;
  unitCost?: number;
  batchNo?: string;
  errors: string[];
}
export interface ImportPreview {
  rows: ImportRowResult[];
  validCount: number;
  errorCount: number;
  canConfirm: boolean;
}
