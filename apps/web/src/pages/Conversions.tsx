import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { conversionSchema, type Paginated } from '@inventory/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Status, errText } from '../components/DocPages';
import { fmtQty, today, useItems, type ItemOption } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/* -------------------------------------------------------------------------- list */

export function ConversionList() {
  const { hasRole } = useAuth();
  const [f, setF] = useState({ q: '', status: 'all', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Paginated<Row> | null>(null);
  const [error, setError] = useState('');
  const pageSize = 20;
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
      api
        .get<Paginated<Row>>(`/conversions?${p}`)
        .then((r) => {
          setRes(r);
          setError('');
        })
        .catch((e) => setError(errText(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [f, page]);
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setF((v) => ({ ...v, [k]: e.target.value }));
      setPage(1);
    };
  const totalPages = Math.max(1, Math.ceil((res?.total ?? 0) / pageSize));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Conversions</h1>
        <Link className="btn-secondary" to="/conversions/templates">
          Templates
        </Link>
        {hasRole('ADMIN', 'MANAGER', 'STORE') && (
          <Link className="btn-primary" to="/conversions/new">
            + New conversion
          </Link>
        )}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <input
          className="input"
          placeholder="Search ID, template, item, remarks…"
          aria-label="Search"
          value={f.q}
          onChange={set('q')}
        />
        <select
          className="input"
          aria-label="Status filter"
          value={f.status}
          onChange={set('status')}
        >
          <option value="all">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <input
          className="input"
          type="date"
          aria-label="From date"
          value={f.from}
          onChange={set('from')}
        />
        <input
          className="input"
          type="date"
          aria-label="To date"
          value={f.to}
          onChange={set('to')}
        />
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
              {['Conversion', 'Date', 'Inputs → Outputs', 'Template', 'Status'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {res?.data.map((d) => (
              <tr key={d.id} className={d.status === 'CANCELLED' ? 'text-slate-400' : ''}>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link
                    className="font-medium text-indigo-700 hover:underline"
                    to={`/conversions/${d.id}`}
                  >
                    {d.conversionNo}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{d.txnDate}</td>
                <td className="px-3 py-2">
                  {d.inputs.map((l: Row) => `${l.item.code} ×${Number(l.qty)}`).join(' + ')} →{' '}
                  {d.outputs.map((l: Row) => `${l.item.code} ×${Number(l.qty)}`).join(' + ')}
                </td>
                <td className="px-3 py-2">{d.template?.name ?? 'Custom'}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Status s={d.status} />
                  {d.status === 'DRAFT' && d.approvalStatus === 'PENDING' && (
                    <span className="ml-2 text-xs text-amber-700">awaiting approval</span>
                  )}
                </td>
              </tr>
            ))}
            {res && res.data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No conversions
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

/* --------------------------------------------------------------------- line editor */

export interface Line {
  itemId: string;
  qty: string;
}

/** Input/output line editor. With `avail`, shows live usable stock per line (summed per item). */
export function LineEditor({
  title,
  lines,
  setLines,
  items,
  avail,
  testId,
}: {
  title: string;
  lines: Line[];
  setLines: (l: Line[]) => void;
  items: ItemOption[];
  avail?: Map<string, number>;
  testId: string;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const upd = (i: number, k: keyof Line, v: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const need = new Map<string, number>();
  lines.forEach(
    (l) => l.itemId && need.set(l.itemId, (need.get(l.itemId) ?? 0) + (Number(l.qty) || 0)),
  );
  return (
    <div className="space-y-2 rounded-lg border bg-white p-4">
      <h2 className="font-medium">{title}</h2>
      {lines.map((l, i) => {
        const item = byId.get(l.itemId);
        const have = avail?.get(l.itemId) ?? 0;
        const short = avail && item && (need.get(l.itemId) ?? 0) > have;
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-12">
            <select
              className="input sm:col-span-7"
              aria-label={`${title} item ${i + 1}`}
              value={l.itemId}
              onChange={(e) => upd(i, 'itemId', e.target.value)}
            >
              <option value="">Select item…</option>
              {items
                .filter((it) => it.active)
                .map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.code} — {it.name}
                  </option>
                ))}
            </select>
            <input
              className="input sm:col-span-3"
              type="number"
              step="0.001"
              placeholder="Qty"
              aria-label={`${title} quantity ${i + 1}`}
              value={l.qty}
              onChange={(e) => upd(i, 'qty', e.target.value)}
            />
            <span className="self-center text-sm text-slate-500 sm:col-span-1">
              {item?.unit?.code ?? ''}
            </span>
            <button
              type="button"
              className="btn-secondary sm:col-span-1"
              disabled={lines.length === 1}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
              aria-label={`Remove ${title} line ${i + 1}`}
            >
              ✕
            </button>
            {avail && item && (
              <p
                className={`text-xs sm:col-span-12 ${short ? 'font-medium text-red-600' : 'text-slate-500'}`}
                data-testid={`${testId}-${i}`}
              >
                Available (usable): {fmtQty(String(have))} {item.unit?.code}
                {short ? ` — need ${fmtQty(String(need.get(l.itemId)))}` : ''}
              </p>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setLines([...lines, { itemId: '', qty: '' }])}
      >
        + Add line
      </button>
    </div>
  );
}

/** Usable stock per item, from the ledger cache (used for live availability hints). */
export function useAvailability() {
  const [avail, setAvail] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    api
      .get<Row[]>('/inventory/balances')
      .then((rows) => {
        const m = new Map<string, number>();
        rows
          .filter((r) => r.stockStatus === 'USABLE')
          .forEach((r) => m.set(r.itemId, (m.get(r.itemId) ?? 0) + Number(r.qty)));
        setAvail(m);
      })
      .catch(() => undefined);
  }, []);
  return avail;
}

/* ------------------------------------------------------------------------ editor */

const blank = (): Line => ({ itemId: '', qty: '' });

export function ConversionEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const items = useItems();
  const avail = useAvailability();
  const [templates, setTemplates] = useState<Row[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [multiplier, setMultiplier] = useState('1');
  const [txnDate, setTxnDate] = useState(today());
  const [remarks, setRemarks] = useState('');
  const [inputs, setInputs] = useState<Line[]>([blank()]);
  const [outputs, setOutputs] = useState<Line[]>([blank()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const idem = useRef(crypto.randomUUID());

  useEffect(() => {
    api
      .get<Paginated<Row>>('/conversion-templates?pageSize=200&status=active')
      .then((r) => setTemplates(r.data))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const n = (location.state as { notice?: string } | null)?.notice;
    if (n) setErrors([n]);
  }, [location.state]);
  useEffect(() => {
    if (!id) return;
    api
      .get<Row>(`/conversions/${id}`)
      .then((d) => {
        if (d.status !== 'DRAFT') return nav(`/conversions/${id}`, { replace: true });
        setTxnDate(d.txnDate);
        setRemarks(d.remarks ?? '');
        setTemplateId(d.templateId ?? '');
        setMultiplier(String(Number(d.multiplier)));
        setInputs(d.inputs.map((l: Row) => ({ itemId: l.itemId, qty: String(Number(l.qty)) })));
        setOutputs(d.outputs.map((l: Row) => ({ itemId: l.itemId, qty: String(Number(l.qty)) })));
      })
      .catch((e) => setErrors([errText(e)]));
  }, [id, nav]);

  async function applyTemplate() {
    if (!templateId) return;
    setErrors([]);
    try {
      const r = await api.get<{ inputs: Line[]; outputs: Line[] }>(
        `/conversion-templates/${templateId}/expand?multiplier=${encodeURIComponent(multiplier || '1')}`,
      );
      setInputs(r.inputs.map((l) => ({ itemId: l.itemId, qty: l.qty })));
      setOutputs(r.outputs.map((l) => ({ itemId: l.itemId, qty: l.qty })));
    } catch (e) {
      setErrors([errText(e)]);
    }
  }

  async function save(confirm: boolean) {
    setErrors([]);
    const parsed = conversionSchema.safeParse({
      txnDate,
      remarks,
      templateId,
      multiplier,
      inputs,
      outputs,
    });
    if (!parsed.success) {
      return setErrors(
        parsed.error.issues.map((i) => {
          const at =
            i.path[0] === 'inputs' || i.path[0] === 'outputs'
              ? `${i.path[0] === 'inputs' ? 'Input' : 'Output'}${typeof i.path[1] === 'number' ? ` line ${i.path[1] + 1}` : ''}: `
              : '';
          return at + i.message;
        }),
      );
    }
    setBusy(true);
    let saved: Row | null = null;
    try {
      saved = id
        ? await api.put<Row>(`/conversions/${id}`, parsed.data)
        : await api.post<Row>('/conversions', parsed.data, { 'Idempotency-Key': idem.current });
      if (confirm) await api.post(`/conversions/${saved.id}/confirm`);
      nav(`/conversions/${saved.id}`);
    } catch (e) {
      const text =
        confirm && saved ? `Saved as draft, but could not confirm: ${errText(e)}` : errText(e);
      if (saved && !id)
        nav(`/conversions/${saved.id}/edit`, { replace: true, state: { notice: text } });
      else setErrors([text]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <h1 className="text-xl font-semibold">{id ? 'Edit' : 'New'} conversion</h1>
      {errors.length > 0 && (
        <ul role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="c-date">
            Date *
          </label>
          <input
            id="c-date"
            type="date"
            className="input"
            max={today()}
            value={txnDate}
            onChange={(e) => setTxnDate(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="c-tpl">
            Template (optional)
          </label>
          <select
            id="c-tpl"
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Custom conversion</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="c-mult">
              Multiplier
            </label>
            <input
              id="c-mult"
              type="number"
              step="0.001"
              min="0"
              className="input"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={!templateId}
            onClick={() => void applyTemplate()}
          >
            Apply
          </button>
        </div>
        <div className="sm:col-span-4">
          <label className="label" htmlFor="c-rem">
            Remarks
          </label>
          <input
            id="c-rem"
            className="input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LineEditor
          title="Inputs (consumed)"
          lines={inputs}
          setLines={setInputs}
          items={items}
          avail={avail}
          testId="in-hint"
        />
        <LineEditor
          title="Outputs (produced)"
          lines={outputs}
          setLines={setOutputs}
          items={items}
          testId="out-hint"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={busy}>
          Save draft
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void save(true)}
        >
          Save &amp; confirm
        </button>
        <Link className="btn-secondary" to="/conversions">
          Cancel
        </Link>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------------ detail */

export function ConversionDetail() {
  const { id } = useParams();
  const { hasRole } = useAuth();
  const [d, setD] = useState<Row | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .get<Row>(`/conversions/${id}`)
      .then(setD)
      .catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, [id]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<Row>(`/conversions/${id}/${path}`, body);
      setD(r);
      if (path === 'confirm') {
        setMsg(
          r.status === 'DRAFT' && r.approvalStatus === 'PENDING'
            ? {
                ok: true,
                text: 'Above the approval threshold — sent to a manager for approval. Stock is unchanged until it is confirmed.',
              }
            : { ok: true, text: 'Confirmed — stock updated.' },
        );
      } else setMsg({ ok: true, text: 'Cancelled.' });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    const reason = prompt(
      `Reason for cancelling ${d!.conversionNo}?${d!.status === 'CONFIRMED' ? ' Inputs will be returned and outputs removed.' : ''}`,
    );
    if (reason) void act('cancel', { reason });
  }
  if (!d)
    return (
      <p className="text-slate-500">
        {msg ? (
          <span role="alert" className="text-red-700">
            {msg.text}
          </span>
        ) : (
          'Loading…'
        )}
      </p>
    );
  const pending = d.status === 'DRAFT' && d.approvalStatus === 'PENDING';
  const table = (title: string, lines: Row[]) => (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <h2 className="border-b bg-slate-50 px-3 py-2 font-medium">{title}</h2>
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2">
                {l.item.code} — {l.item.name}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtQty(l.qty)} {l.unit.code}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">
          {d.conversionNo} <Status s={d.status} />
        </h1>
        {d.status === 'DRAFT' && hasRole('ADMIN', 'MANAGER', 'STORE') && (
          <>
            <Link className="btn-secondary" to={`/conversions/${id}/edit`}>
              Edit
            </Link>
            <button className="btn-primary" disabled={busy} onClick={() => void act('confirm')}>
              {pending && hasRole('ADMIN', 'MANAGER') ? 'Approve & confirm' : 'Confirm'}
            </button>
          </>
        )}
        {d.status !== 'CANCELLED' && hasRole('ADMIN', 'MANAGER') && (
          <button className="btn-danger" disabled={busy} onClick={cancel}>
            Cancel
          </button>
        )}
        <Link className="btn-secondary" to="/conversions">
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
      {pending && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">
          Awaiting manager approval (total input {fmtQty(d.totals.inputQty)} is above the
          threshold).
        </p>
      )}
      {d.status === 'CANCELLED' && (
        <p className="rounded bg-slate-100 p-2 text-sm">Cancelled: {d.cancelReason}</p>
      )}
      <dl className="grid gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-4">
        {[
          ['Date', d.txnDate],
          ['Template', d.template?.name ?? 'Custom'],
          ['Multiplier', Number(d.multiplier)],
          ['Warehouse', d.warehouse?.name],
          ['Approval', d.approvalStatus === 'NONE' ? '—' : d.approvalStatus],
          ['Remarks', d.remarks],
          ['Created by', d.createdBy?.name],
        ].map(([k, v]) => (
          <div key={String(k)}>
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium">{v ? String(v) : '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        {table('Inputs (consumed)', d.inputs)}
        {table('Outputs (produced)', d.outputs)}
      </div>
    </div>
  );
}
