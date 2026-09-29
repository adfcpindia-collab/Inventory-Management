export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication required') =>
  new HttpError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'Insufficient permissions') => new HttpError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'NOT_FOUND', m);
export const conflict = (m: string, d?: unknown) => new HttpError(409, 'CONFLICT', m, d);
export const unprocessable = (m: string, d?: unknown) => new HttpError(422, 'UNPROCESSABLE', m, d);
