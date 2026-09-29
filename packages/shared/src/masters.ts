import { z } from 'zod';
import { PRODUCT_TYPES, TRACKING_TYPES } from './enums';
import { money, optionalText, qty, requiredText, emptyToUndef } from './common';

export const categorySchema = z.object({
  name: requiredText(100),
  description: optionalText(300),
});

export const unitSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/, 'Letters/digits, max 10'),
  name: requiredText(50),
});

const gstin = z.preprocess(
  emptyToUndef,
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/, 'Invalid GSTIN')
    .optional(),
);
const phone = z.preprocess(
  emptyToUndef,
  z
    .string()
    .trim()
    .regex(/^[0-9+()\-\s]{6,20}$/, 'Invalid phone')
    .optional(),
);
const email = z.preprocess(emptyToUndef, z.string().trim().toLowerCase().email().optional());

/** Shared shape for Client and Supplier masters. */
const partyShape = {
  companyName: requiredText(200),
  contactPerson: optionalText(100),
  phone,
  email,
  address: optionalText(500),
  gstin,
  remarks: optionalText(500),
};
export const clientSchema = z.object(partyShape);
export const supplierSchema = z.object(partyShape);

export const itemSchema = z
  .object({
    code: z.string().trim().toUpperCase().min(1).max(50),
    name: requiredText(200),
    categoryId: z.string().uuid(),
    subcategory: optionalText(100),
    description: optionalText(500),
    unitId: z.string().uuid(),
    productType: z.enum(PRODUCT_TYPES),
    trackingType: z.enum(TRACKING_TYPES).default('NONE'),
    minLevel: qty.default(0),
    reorderLevel: qty.default(0),
    maxLevel: qty.default(0),
    hsnSac: z.preprocess(
      emptyToUndef,
      z
        .string()
        .trim()
        .regex(/^\d{4,8}$/, 'HSN/SAC must be 4–8 digits')
        .optional(),
    ),
    gstRate: z.coerce.number().min(0).max(100).default(0),
    purchasePrice: money.default(0),
    sellingPrice: money.default(0),
  })
  .refine((v) => v.minLevel <= v.reorderLevel, {
    path: ['reorderLevel'],
    message: 'Reorder level must be ≥ minimum level',
  })
  .refine((v) => v.maxLevel === 0 || v.maxLevel >= v.reorderLevel, {
    path: ['maxLevel'],
    message: 'Maximum level must be ≥ reorder level (or 0 for unset)',
  });

export type ItemInput = z.infer<typeof itemSchema>;
export type ClientInput = z.infer<typeof clientSchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type UnitInput = z.infer<typeof unitSchema>;
