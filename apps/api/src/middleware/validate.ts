import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Source = 'body' | 'query' | 'params';

/** Parses and replaces the request part with the validated value. */
export const validate =
  (schema: ZodTypeAny, source: Source = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };

export type Parsed<T extends ZodTypeAny> = z.infer<T>;
