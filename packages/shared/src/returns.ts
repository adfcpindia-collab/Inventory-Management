import { z } from 'zod';
import { emptyToUndef, optionalText, requiredText } from './common';
import { dateString, positiveQty } from './inventory';

const optUuid = z.preprocess(emptyToUndef, z.string().uuid().optional());

export const RETURN_CONDITIONS = ['GOOD', 'DAMAGED', 'NEEDS_INSPECTION'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

/** Where returned goods land: only GOOD becomes usable stock. */
export const CONDITION_BUCKET = {
  GOOD: 'USABLE',
  DAMAGED: 'DAMAGED',
  NEEDS_INSPECTION: 'INSPECTION',
} as const;

const docNo = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(50)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f]/.test(s), 'Invalid characters');

export const customerReturnSchema = z.object({
  returnNo: docNo,
  txnDate: dateString,
  /** The confirmed challan being returned against. */
  dispatchId: z.string().uuid('Select the original challan'),
  warehouseId: optUuid,
  remarks: optionalText(500),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid('Select an item'),
        qty: positiveQty,
        condition: z.enum(RETURN_CONDITIONS),
        reason: optionalText(200),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200),
});
export type CustomerReturnInput = z.infer<typeof customerReturnSchema>;

export const supplierReturnSchema = z.object({
  returnNo: docNo,
  txnDate: dateString,
  /** The confirmed GRN being returned against. */
  procurementId: z.string().uuid('Select the original GRN'),
  warehouseId: optUuid,
  remarks: optionalText(500),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid('Select an item'),
        qty: positiveQty,
        /** Which bucket the goods leave from. */
        stockStatus: z.enum(['USABLE', 'DAMAGED']).default('USABLE'),
        reason: optionalText(200),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200),
});
export type SupplierReturnInput = z.infer<typeof supplierReturnSchema>;

export const STOCK_ACTIONS = ['DAMAGE', 'SCRAP', 'REPAIR'] as const;
export type StockAction = (typeof STOCK_ACTIONS)[number];

/** DAMAGE: USABLE → DAMAGED · SCRAP: removes DAMAGED · REPAIR: DAMAGED → USABLE. */
export const stockActionSchema = z.object({
  action: z.enum(STOCK_ACTIONS),
  txnDate: dateString,
  warehouseId: optUuid,
  itemId: z.string().uuid('Select an item'),
  qty: positiveQty,
  reason: requiredText(300),
  remarks: optionalText(500),
});
export type StockActionInput = z.infer<typeof stockActionSchema>;

const nonNegQty = z.coerce
  .number({ invalid_type_error: 'Physical quantity must be a number' })
  .finite()
  .min(0, 'Must be ≥ 0')
  .max(999_999_999_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Max 3 decimal places');

export const stockAdjustmentSchema = z.object({
  txnDate: dateString,
  warehouseId: optUuid,
  itemId: z.string().uuid('Select an item'),
  /** Bucket being counted; defaults to usable stock. */
  stockStatus: z.enum(['USABLE', 'DAMAGED', 'INSPECTION']).default('USABLE'),
  physicalQty: nonNegQty,
  reason: requiredText(300),
  remarks: optionalText(500),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
