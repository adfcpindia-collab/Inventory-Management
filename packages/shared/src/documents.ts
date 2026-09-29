import { z } from 'zod';
import { emptyToUndef, optionalText } from './common';
import { dateString, positiveQty } from './inventory';

export const DOC_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

const optUuid = z.preprocess(emptyToUndef, z.string().uuid().optional());
const optMoney = (max = 9_999_999_999_999) =>
  z.preprocess(
    emptyToUndef,
    z.coerce
      .number({ invalid_type_error: 'Must be a number' })
      .finite()
      .min(0, 'Must be ≥ 0')
      .max(max)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Max 2 decimal places')
      .optional(),
  );

/** Document numbers: trimmed, printable, no control characters. */
const docNo = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(50)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f]/.test(s), 'Invalid characters');

export const procurementLineSchema = z.object({
  itemId: z.string().uuid('Select an item'),
  qty: positiveQty,
  /** Optional; when given it must equal the item's unit. */
  unitId: optUuid,
  rate: optMoney().refine((v) => v !== undefined, 'Rate is required'),
  /** Defaults to the item's GST rate. */
  gstRate: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(100).optional()),
  batchNo: optionalText(50),
});

export const procurementSchema = z.object({
  grnNo: docNo,
  txnDate: dateString,
  supplierId: z.string().uuid('Select a supplier'),
  warehouseId: optUuid,
  remarks: optionalText(500),
  lines: z.array(procurementLineSchema).min(1, 'Add at least one item').max(200),
});
export type ProcurementInput = z.infer<typeof procurementSchema>;

export const dispatchLineSchema = z.object({
  itemId: z.string().uuid('Select an item'),
  qty: positiveQty,
  unitId: optUuid,
  rate: optMoney(),
});

export const dispatchSchema = z.object({
  challanNo: docNo,
  txnDate: dateString,
  clientId: z.string().uuid('Select a client'),
  warehouseId: optUuid,
  /** Defaults to the client's address. */
  address: optionalText(500),
  vehicleNo: optionalText(30),
  driverName: optionalText(100),
  salesOrderNo: optionalText(50),
  remarks: optionalText(500),
  lines: z.array(dispatchLineSchema).min(1, 'Add at least one item').max(200),
});
export type DispatchInput = z.infer<typeof dispatchSchema>;

export const docListQuery = z.object({
  q: z.preprocess(emptyToUndef, z.string().trim().max(100).optional()),
  status: z.enum([...DOC_STATUSES, 'all']).default('all'),
  from: z.preprocess(emptyToUndef, dateString.optional()),
  to: z.preprocess(emptyToUndef, dateString.optional()),
  partyId: optUuid,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type DocListQuery = z.infer<typeof docListQuery>;
