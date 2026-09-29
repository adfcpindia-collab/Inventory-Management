import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { conversionTemplateSchema, type Paginated } from '@inventory/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { errText } from '../components/DocPages';
import { useItems } from '../lib';
import { LineEditor, type Line } from './Conversions';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
const blank = (): Line => ({ itemId: '', qty: '' });

export default function ConversionTemplates() {
  const { hasRole } = useAuth();
  const canWrite = hasRole('ADMIN', 'MANAGER');
  const items = useItems();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    description: string;
    inputs: Line[];
    outputs: Line[];
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = () => {
    const p = new URLSearchParams({ pageSize: '100', status });
    if (q.trim()) p.set('q', q.trim());
    api
      .get<Paginated<Row>>(`/conversion-templates?${p}`)
      .then((r) => {
        setRows(r.data);
        setError('');
      })
      .catch((e) => setError(errText(e)));
  };
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [q, status]);

  const toLines = (ls: Row[]): Line[] =>
    ls.map((l) => ({ itemId: l.itemId, qty: String(Number(l.qty)) }));
  async function save() {
    if (!editing) return;
    const parsed = conversionTemplateSchema.safeParse(editing);
    if (!parsed.success)
      return setErrors(
        parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message),
      );
    try {
      if (editing.id) await api.put(`/conversion-templates/${editing.id}`, parsed.data);
      else await api.post('/conversion-templates', parsed.data);
      setEditing(null);
      setErrors([]);
      load();
    } catch (e) {
      setErrors([errText(e)]);
    }
  }
  async function toggle(r: Row) {
    if (r.active && !confirm('Deactivate this template?')) return;
    try {
      if (r.active) await api.del(`/conversion-templates/${r.id}`);
      else await api.post(`/conversion-templates/${r.id}/activate`);
      load();
    } catch (e) {
      setError(errText(e));
    }
  }
  const desc = (ls: Row[]) => ls.map((l) => `${l.item.code} ×${Number(l.qty)}`).join(' + ');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Conversion templates</h1>
        <input
          className="input w-full sm:w-64"
          placeholder="Search…"
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input w-auto"
          aria-label="Status filter"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <Link className="btn-secondary" to="/conversions">
          Conversions
        </Link>
        {canWrite && (
          <button
            className="btn-primary"
            onClick={() => {
              setErrors([]);
              setEditing({ name: '', description: '', inputs: [blank()], outputs: [blank()] });
            }}
          >
            + New template
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
              {['Name', 'Recipe (per 1×)', 'Status', ''].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'text-slate-400'}>
                <td className="whitespace-nowrap px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2">
                  {desc(r.inputs)} → {desc(r.outputs)}
                </td>
                <td className="px-3 py-2">{r.active ? 'Active' : 'Inactive'}</td>
                <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
                  {canWrite && (
                    <>
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setErrors([]);
                          setEditing({
                            id: r.id,
                            name: r.name,
                            description: r.description ?? '',
                            inputs: toLines(r.inputs),
                            outputs: toLines(r.outputs),
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className={r.active ? 'btn-danger' : 'btn-secondary'}
                        onClick={() => void toggle(r)}
                      >
                        {r.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No templates
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="my-8 w-full max-w-3xl space-y-4 rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">{editing.id ? 'Edit' : 'New'} template</h2>
            {errors.length > 0 && (
              <ul role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="t-name">
                  Name *
                </label>
                <input
                  id="t-name"
                  className="input"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="t-desc">
                  Description
                </label>
                <input
                  id="t-desc"
                  className="input"
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
            </div>
            <p className="text-sm text-slate-500">
              Quantities are for ONE run; a conversion scales them by its multiplier.
            </p>
            <LineEditor
              title="Inputs"
              lines={editing.inputs}
              setLines={(inputs) => setEditing({ ...editing, inputs })}
              items={items}
              testId="t-in"
            />
            <LineEditor
              title="Outputs"
              lines={editing.outputs}
              setLines={(outputs) => setEditing({ ...editing, outputs })}
              items={items}
              testId="t-out"
            />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
