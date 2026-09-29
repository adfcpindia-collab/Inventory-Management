import { z } from 'zod';

/** Empty strings from HTML forms become undefined. */
export const emptyToUndef = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

export const optionalText = (max = 500) =>
  z.preprocess(emptyToUndef, z.string().trim().max(max).optional());

export const requiredText = (max = 200) => z.string().trim().min(1, 'Required').max(max);

/** Non-negative decimal with max 3 fraction digits (quantities, NUMERIC(18,3)). */
export const qty = z.coerce
  .number()
  .finite()
  .min(0, 'Must be ≥ 0')
  .max(999_999_999_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Max 3 decimal places');

/** Non-negative money with max 2 fraction digits (NUMERIC(18,2)). */
export const money = z.coerce
  .number()
  .finite()
  .min(0, 'Must be ≥ 0')
  .max(9_999_999_999_999)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Max 2 decimal places');

export const idParam = z.object({ id: z.string().uuid() });

export const listQuery = z.object({
  q: z.preprocess(emptyToUndef, z.string().trim().max(100).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type ListQuery = z.infer<typeof listQuery>;

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
