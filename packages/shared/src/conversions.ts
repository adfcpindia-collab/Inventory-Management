import { z } from 'zod';
import { emptyToUndef, optionalText, requiredText } from './common';
import { dateString, positiveQty } from './inventory';

const optUuid = z.preprocess(emptyToUndef, z.string().uuid().optional());

export const conversionLineSchema = z.object({
  itemId: z.string().uuid('Select an item'),
  qty: positiveQty,
  /** Optional; when given it must equal the item's unit. */
  unitId: optUuid,
});
export type ConversionLineInput = z.infer<typeof conversionLineSchema>;

/** An item cannot be both consumed and produced by the same conversion. */
const noOverlap = (v: { inputs?: { itemId: string }[]; outputs?: { itemId: string }[] }) => {
  const out = new Set((v.outputs ?? []).map((l) => l.itemId));
  return !(v.inputs ?? []).some((l) => out.has(l.itemId));
};
const overlapMsg = { path: ['outputs'], message: 'An item cannot be both an input and an output' };

export const conversionTemplateSchema = z
  .object({
    name: requiredText(100),
    description: optionalText(300),
    /** Quantities are per ONE unit of the multiplier. */
    inputs: z.array(conversionLineSchema).min(1, 'Add at least one input').max(50),
    outputs: z.array(conversionLineSchema).min(1, 'Add at least one output').max(50),
  })
  .refine(noOverlap, overlapMsg);
export type ConversionTemplateInput = z.infer<typeof conversionTemplateSchema>;

const multiplier = z.coerce
  .number({ invalid_type_error: 'Multiplier must be a number' })
  .gt(0, 'Multiplier must be greater than 0')
  .max(1_000_000)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Max 3 decimal places');

/**
 * Either base it on a template (lines are derived server-side × multiplier) or send explicit
 * inputs and outputs (custom conversion; also used to tweak a scaled template).
 */
export const conversionSchema = z
  .object({
    txnDate: dateString,
    warehouseId: optUuid,
    remarks: optionalText(500),
    templateId: optUuid,
    multiplier: z.preprocess(emptyToUndef, multiplier.default(1)),
    inputs: z.array(conversionLineSchema).max(50).optional(),
    outputs: z.array(conversionLineSchema).max(50).optional(),
  })
  .refine((v) => v.templateId || (v.inputs?.length && v.outputs?.length), {
    path: ['inputs'],
    message: 'Pick a template or add at least one input and one output',
  })
  .refine(noOverlap, overlapMsg);
export type ConversionInput = z.infer<typeof conversionSchema>;

export const settingsSchema = z.object({
  /** Total input quantity above which a STORE confirm needs manager approval; null disables. */
  conversionApprovalThreshold: z.number().gt(0).max(999_999_999_999).nullable(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;
