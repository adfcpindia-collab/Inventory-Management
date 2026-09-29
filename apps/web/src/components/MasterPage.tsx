import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ZodTypeAny } from 'zod';
import type { Paginated } from '@inventory/shared';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select';
  step?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  /** Load select options from a master endpoint (active rows only). */
  optionsFrom?: { endpoint: string; label: (r: Row) => string };
}

export interface MasterConfig {
  title: string;
  endpoint: string;
  schema: ZodTypeAny;
  columns: { label: string; render: (r: Row) => ReactNode }[];
  fields: FieldDef[];
  defaults?: Row;
  /** Map an API row to editable form values. */
  toForm?: (r: Row) => Row;
}

const WRITE = ['ADMIN', 'MANAGER'] as const;

export default function MasterPage({ cfg }: { cfg: MasterConfig }) {
  const { hasRole } = useAuth();
  const canWrite = hasRole(...WRITE);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Row> | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id?: string; values: Row } | null>(null);
  const pageSize = 15;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status,
      });
      if (q.trim()) params.set('q', q.trim());
      setResult(await api.get<Paginated<Row>>(`${cfg.endpoint}?${params}`));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [cfg.endpoint, page, q, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250); // debounce search typing
    return () => clearTimeout(t);
  }, [load]);

  async function toggle(r: Row) {
    if (r.active && !confirm('Deactivate this record? It will be hidden from active lists.'))
      return;
    try {
      if (r.active) await api.del(`${cfg.endpoint}/${r.id}`);
      else await api.post(`${cfg.endpoint}/${r.id}/activate`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / pageSize));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{cfg.title}</h1>
        <input
          className="input w-full sm:w-64"
          placeholder="Search…"
          aria-label="Search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="input w-auto"
          aria-label="Status filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        {canWrite && (
          <button
            className="btn-primary"
            onClick={() => setEditing({ values: { ...cfg.defaults } })}
          >
            + New
          </button>
        )}
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
              {cfg.columns.map((c) => (
                <th key={c.label} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Status</th>
              {canWrite && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result?.data.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'text-slate-400'}>
                {cfg.columns.map((c) => (
                  <td key={c.label} className="whitespace-nowrap px-3 py-2">
                    {c.render(r)}
                  </td>
                ))}
                <td className="px-3 py-2">{r.active ? 'Active' : 'Inactive'}</td>
                {canWrite && (
                  <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        setEditing({ id: r.id, values: cfg.toForm ? cfg.toForm(r) : { ...r } })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className={r.active ? 'btn-danger' : 'btn-secondary'}
                      onClick={() => void toggle(r)}
                    >
                      {r.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {result && result.data.length === 0 && (
              <tr>
                <td
                  colSpan={cfg.columns.length + 2}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  No records
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{result?.total ?? 0} records</span>
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

      {editing && (
        <MasterForm
          cfg={cfg}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function MasterForm({
  cfg,
  initial,
  onClose,
  onSaved,
}: {
  cfg: MasterConfig;
  initial: { id?: string; values: Row };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Row>(initial.values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  useEffect(() => {
    for (const f of cfg.fields) {
      if (!f.optionsFrom) continue;
      const { endpoint, label } = f.optionsFrom;
      api
        .get<Paginated<Row>>(`${endpoint}?pageSize=200&status=active`)
        .then((r) =>
          setOptions((o) => ({
            ...o,
            [f.name]: r.data.map((x) => ({ value: x.id, label: label(x) })),
          })),
        )
        .catch(() => setFormError('Failed to load options'));
    }
  }, [cfg.fields]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    // Same Zod schema the API uses (packages/shared).
    const parsed = cfg.schema.safeParse(values);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join('.')] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (initial.id) await api.put(`${cfg.endpoint}/${initial.id}`, parsed.data);
      else await api.post(cfg.endpoint, parsed.data);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      }
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-2xl space-y-4 rounded-lg bg-white p-5 shadow-xl"
        noValidate
      >
        <h2 className="text-lg font-semibold">
          {initial.id ? 'Edit' : 'New'} {cfg.title}
        </h2>
        {formError && (
          <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
            {formError}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {cfg.fields.map((f) => {
            const id = `f-${f.name}`;
            const common = {
              id,
              className: 'input',
              value: values[f.name] ?? '',
              onChange: (
                e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>,
              ) => setValues((v) => ({ ...v, [f.name]: e.target.value })),
            };
            return (
              <div key={f.name} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="label" htmlFor={id}>
                  {f.label}
                  {f.required && ' *'}
                </label>
                {f.type === 'textarea' ? (
                  <textarea rows={2} {...common} />
                ) : f.type === 'select' ? (
                  <select {...common}>
                    <option value="">Select…</option>
                    {(f.options ?? options[f.name] ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type={f.type === 'number' ? 'number' : 'text'} step={f.step} {...common} />
                )}
                {errors[f.name] && <p className="mt-1 text-xs text-red-600">{errors[f.name]}</p>}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
