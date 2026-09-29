import type { AuthUser, Paginated } from '@inventory/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<AuthUser | null> | null = null;

async function raw(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
}

/** Exchanges the httpOnly refresh cookie for a new access token (single flight). */
export function refreshSession(): Promise<AuthUser | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return null;
      const body = await res.json();
      accessToken = body.accessToken;
      return body.user as AuthUser;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && !path.startsWith('/auth/') && (await refreshSession())) {
    res = await raw(path, init);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.message ?? 'Request failed', body?.error?.details);
  }
  return body as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, b?: unknown, headers?: Record<string, string>) =>
    request<T>(p, {
      method: 'POST',
      body: b === undefined ? undefined : JSON.stringify(b),
      headers,
    }),
  put: <T>(p: string, b: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(b) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  /** Sends a file as the raw request body (used for .xlsx uploads). */
  async upload<T>(path: string, file: File, headers: Record<string, string> = {}): Promise<T> {
    const send = () =>
      fetch(`/api${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...headers,
        },
        body: file,
      });
    let res = await send();
    if (res.status === 401 && (await refreshSession())) res = await send();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new ApiError(
        res.status,
        body?.error?.message ?? 'Upload failed',
        body?.error?.details,
      );
      (err as ApiError & { payload?: unknown }).payload = body?.error?.details;
      throw err;
    }
    return body as T;
  },
  /** Authenticated file download (the token is not available to plain <a href>). */
  async download(path: string, filename: string) {
    let res = await raw(path);
    if (res.status === 401 && (await refreshSession())) res = await raw(path);
    if (!res.ok) throw new ApiError(res.status, 'Download failed');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  },
  async login(email: string, password: string) {
    const res = await raw('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? 'Login failed');
    accessToken = body.accessToken;
    return body.user as AuthUser;
  },
  async logout() {
    await raw('/auth/logout', { method: 'POST' });
    accessToken = null;
  },
};

export type { Paginated };
