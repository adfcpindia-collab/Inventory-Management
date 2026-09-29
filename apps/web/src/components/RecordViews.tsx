import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ZodTypeAny } from 'zod';
import type { Paginated, Role } from '@inventory/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { errText, Status } from './DocPages';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;
export { Status, errText };

export interface Column {
  label: string;
  cell: (d: Row) => ReactNode;
}

export function RecordList({
  title,
  endpoint,
  basePath,
  columns,
  singular,
}: {
  title: string;
  endpoint: string;
  basePath: string;
  singular: string;
  columns: Column[];
}) {
  const { hasRole } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Paginated<Row> | null>(null);
  const [error, setError] = useState('');
  const pageSize = 20;

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status });
      if (q) p.set('q', q);
      api
        .get<Paginated<Row>>(`${endpoint}?${p}`)
        .then((r) => {
          setRes(r);
          setError('');
        })
        .catch((e) => setError(errText(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [endpoint, q, status, page]);

  const totalPages = Math.max(1, Math.ceil((res?.total ?? 0) / pageSize));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{title}</h1>
        {hasRole('ADMIN', 'MANAGER', 'STORE') && (
          <Link className="btn-primary" to={`${basePath}/new`}>
            + New {singular}
          </Link>
        )}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <input
          className="input"
          placeholder="Search number, item, reason…"
          aria-label="Search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="input"
          aria-label="Status filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              {[...columns.map((c) => c.label), 'Status'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {res?.data.map((d) => (
              <tr key={d.id} className={d.status === 'CANCELLED' ? 'text-slate-400' : ''}>
                {columns.map((c, i) => (
                  <td key={c.label} className="whitespace-nowrap px-3 py-2">
                    {i === 0 ? (
                      <Link
                        className="font-medium text-indigo-700 hover:underline"
                        to={`${basePath}/${d.id}`}
                      >
                        {c.cell(d)}
                      </Link>
                    ) : (
                      c.cell(d)
                    )}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <Status s={d.status} />
                </td>
              </tr>
            ))}
            {res && res.data.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-slate-500">
                  No records
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{res?.total ?? 0} records</span>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Prev
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            className="btn-secondary"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

const Info = ({ k, v }: { k: string; v: ReactNode }) => (
  <div>
    <dt className="text-slate-500">{k}</dt>
    <dd className="font-medium">{v || '—'}</dd>
  </div>
);

export function RecordDetail({
  endpoint,
  basePath,
  heading,
  fields,
  lines,
  confirmLabel,
  banner,
}: {
  endpoint: string;
  basePath: string;
  heading: (d: Row) => string;
  fields: (d: Row) => [string, ReactNode][];
  lines?: { head: string[]; row: (l: Row) => ReactNode[]; get: (d: Row) => Row[] };
  /** Label of the confirm button for this document/role; null hides it. */
  confirmLabel: (d: Row, role: Role) => string | null;
  banner?: (d: Row) => ReactNode;
}) {
  const { id } = useParams();
  const { user, hasRole } = useAuth();
  const [d, setD] = useState<Row | null>(null);
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    notice ? { ok: false, text: `Saved as draft, but could not confirm: ${notice}` } : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Row>(`${endpoint}/${id}`)
      .then(setD)
      .catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, [endpoint, id]);

  async function act(path: string, body: unknown, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      setD(await api.post<Row>(`${endpoint}/${id}/${path}`, body));
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    const reason = prompt(
      `Reason for cancelling ${heading(d!)}?${d!.status === 'CONFIRMED' ? ' Stock will be reversed.' : ''}`,
    );
    if (reason) void act('cancel', { reason }, 'Cancelled.');
  }

  if (!d)
    return msg ? (
      <p role="alert" className="text-red-700">
        {msg.text}
      </p>
    ) : (
      <p className="text-slate-500">Loading…</p>
    );
  const label = user ? confirmLabel(d, user.role) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">
          {heading(d)} <Status s={d.status} />
        </h1>
        {d.status === 'DRAFT' && hasRole('ADMIN', 'MANAGER', 'STORE') && (
          <>
            <Link className="btn-secondary" to={`${basePath}/${id}/edit`}>
              Edit
            </Link>
            {label && (
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void act('confirm', undefined, 'Done.')}
              >
                {label}
              </button>
            )}
          </>
        )}
        {d.status !== 'CANCELLED' && hasRole('ADMIN', 'MANAGER') && (
          <button className="btn-danger" disabled={busy} onClick={cancel}>
            {d.status === 'DRAFT' && d.approvalStatus === 'PENDING' ? 'Reject' : 'Cancel'}
          </button>
        )}
        <Link className="btn-secondary" to={basePath}>
          Back
        </Link>
      </div>
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={`rounded p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}
        >
          {msg.text}
        </p>
      )}
      {banner?.(d)}
      {d.status === 'CANCELLED' && (
        <p className="rounded bg-slate-100 p-2 text-sm">Cancelled: {d.cancelReason}</p>
      )}
      <dl className="grid gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-3">
        {fields(d).map(([k, v]) => (
          <Info key={k} k={k} v={v} />
        ))}
      </dl>
      {lines && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                {lines.head.map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.get(d).map((l) => (
                <tr key={l.id}>
                  {lines.row(l).map((c, i) => (
                    <td key={i} className="px-3 py-2">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Shared save flow for the editors: validates with the shared Zod schema, creates (with an
 * idempotency key) or updates, optionally confirms, then opens the record.
 */
export function useRecordSave({
  endpoint,
  basePath,
  schema,
  id,
}: {
  endpoint: string;
  basePath: string;
  schema: ZodTypeAny;
  id?: string;
}) {
  const nav = useNavigate();
  const idem = useRef(crypto.randomUUID());
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function save(payload: unknown, confirm: boolean) {
    setErrors([]);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return setErrors(
        parsed.error.issues.map((i) => {
          const li = i.path.indexOf('lines');
          return li >= 0 && typeof i.path[li + 1] === 'number'
            ? `Line ${Number(i.path[li + 1]) + 1}: ${i.message}`
            : i.message;
        }),
      );
    }
    setBusy(true);
    let saved: Row | null = null;
    try {
      saved = id
        ? await api.put<Row>(`${endpoint}/${id}`, parsed.data)
        : await api.post<Row>(endpoint, parsed.data, { 'Idempotency-Key': idem.current });
      if (confirm) await api.post(`${endpoint}/${saved.id}/confirm`);
      nav(`${basePath}/${saved.id}`);
    } catch (e) {
      const msg = errText(e);
      if (saved && confirm) {
        // The draft exists; open it so the user can fix the problem and retry.
        nav(`${basePath}/${saved.id}`, { state: { notice: msg } });
      } else setErrors([msg]);
    } finally {
      setBusy(false);
    }
  }
  return { save, errors, busy, setErrors };
}

export const ErrorList = ({ errors }: { errors: string[] }) =>
  errors.length > 0 ? (
    <ul role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  ) : null;
