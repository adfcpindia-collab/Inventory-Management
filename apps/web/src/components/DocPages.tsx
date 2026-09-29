import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ZodTypeAny } from 'zod';
import type { Paginated } from '@inventory/shared';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { fmtQty, today, useItems } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface DocConfig {
  kind: 'procurement' | 'dispatch';
  title: string;
  singular: string;
  basePath: string; // route prefix, e.g. /dispatch
  endpoint: string; // api prefix, e.g. /dispatches
  noField: string;
  noLabel: string;
  party: { field: string; rel: string; label: string; endpoint: string };
  schema: ZodTypeAny;
  /** Extra header inputs (besides number/date/party/remarks). */
  extra: { name: string; label: string; wide?: boolean }[];
  lines: { rate: 'required' | 'optional'; gst?: boolean; batch?: boolean; stockHint?: boolean };
  printable?: boolean;
}

const badge: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-200 text-slate-600',
};
export const Status = ({ s }: { s: string }) => (
  <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge[s]}`}>{s}</span>
);
const money = (v: unknown) =>
  v == null || v === ''
    ? '—'
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Failed');

/* -------------------------------------------------------------------------- list */

export function DocList({ cfg }: { cfg: DocConfig }) {
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
        .get<Paginated<Row>>(`${cfg.endpoint}?${p}`)
        .then((r) => {
          setRes(r);
          setError('');
        })
        .catch((e) => setError(errText(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [cfg.endpoint, f, page]);

  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setF((v) => ({ ...v, [k]: e.target.value }));
      setPage(1);
    };
  const totalPages = Math.max(1, Math.ceil((res?.total ?? 0) / pageSize));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{cfg.title}</h1>
        {hasRole('ADMIN', 'MANAGER', 'STORE') && (
          <Link className="btn-primary" to={`${cfg.basePath}/new`}>
            + New {cfg.singular}
          </Link>
        )}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <input
          className="input"
          placeholder="Search number, party, item, remarks…"
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
              {[cfg.noLabel, 'Date', cfg.party.label, 'Items', 'Total', 'Status'].map((h) => (
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
                    to={`${cfg.basePath}/${d.id}`}
                  >
                    {d[cfg.noField]}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{d.txnDate}</td>
                <td className="px-3 py-2">{d[cfg.party.rel]?.companyName}</td>
                <td className="px-3 py-2">{d.lines.length}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(d.totals.total)}</td>
                <td className="px-3 py-2">
                  <Status s={d.status} />
                </td>
              </tr>
            ))}
            {res && res.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
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

/* ------------------------------------------------------------------------ editor */

interface LineState {
  itemId: string;
  qty: string;
  rate: string;
  gstRate: string;
  batchNo: string;
}
const blankLine = (): LineState => ({ itemId: '', qty: '', rate: '', gstRate: '', batchNo: '' });

export function DocEditor({ cfg }: { cfg: DocConfig }) {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const items = useItems();
  const [parties, setParties] = useState<Row[]>([]);
  const [avail, setAvail] = useState<Map<string, number>>(new Map());
  const [head, setHead] = useState<Row>({
    [cfg.noField]: '',
    txnDate: today(),
    partyId: '',
    remarks: '',
    address: '',
    vehicleNo: '',
    driverName: '',
    salesOrderNo: '',
  });
  const [lines, setLines] = useState<LineState[]>([blankLine()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const idem = useRef(crypto.randomUUID());
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  useEffect(() => {
    api
      .get<Paginated<Row>>(`${cfg.party.endpoint}?pageSize=200&status=active`)
      .then((r) => setParties(r.data))
      .catch(() => undefined);
    if (cfg.lines.stockHint) {
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
    }
  }, [cfg]);

  useEffect(() => {
    if (!id) return;
    api
      .get<Row>(`${cfg.endpoint}/${id}`)
      .then((d) => {
        if (d.status !== 'DRAFT') return nav(`${cfg.basePath}/${id}`, { replace: true });
        setHead({
          ...d,
          partyId: d[cfg.party.field],
          remarks: d.remarks ?? '',
          address: d.address ?? '',
          vehicleNo: d.vehicleNo ?? '',
          driverName: d.driverName ?? '',
          salesOrderNo: d.salesOrderNo ?? '',
        });
        setLines(
          d.lines.map((l: Row) => ({
            itemId: l.itemId,
            qty: String(Number(l.qty)),
            rate: l.rate == null ? '' : String(Number(l.rate)),
            gstRate: l.gstRate == null ? '' : String(Number(l.gstRate)),
            batchNo: l.batchNo ?? '',
          })),
        );
      })
      .catch((e) => setErrors([errText(e)]));
  }, [id, cfg, nav]);

  // The route component is reused when we jump to /:id/edit after a failed confirm, so pick up
  // the carried-over reason here rather than in a state initializer.
  useEffect(() => {
    const n = (location.state as { notice?: string } | null)?.notice;
    if (n) setErrors([n]);
  }, [location.state]);

  const setH = (k: string, v: string) => setHead((h) => ({ ...h, [k]: v }));
  const upd = (i: number, k: keyof LineState, v: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  function pickParty(v: string) {
    setHead((h) => {
      const p = parties.find((x) => x.id === v);
      return {
        ...h,
        partyId: v,
        ...(cfg.kind === 'dispatch' && p && !h.address ? { address: p.address ?? '' } : {}),
      };
    });
  }

  function payload() {
    const base: Row = {
      [cfg.noField]: head[cfg.noField],
      txnDate: head.txnDate,
      [cfg.party.field]: head.partyId,
      remarks: head.remarks,
    };
    cfg.extra.forEach((x) => (base[x.name] = head[x.name]));
    base.lines = lines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty,
      rate: l.rate,
      ...(cfg.lines.gst ? { gstRate: l.gstRate } : {}),
      ...(cfg.lines.batch ? { batchNo: l.batchNo } : {}),
    }));
    return base;
  }

  async function save(confirm: boolean) {
    setErrors([]);
    const parsed = cfg.schema.safeParse(payload());
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
        ? await api.put<Row>(`${cfg.endpoint}/${id}`, parsed.data)
        : await api.post<Row>(cfg.endpoint, parsed.data, { 'Idempotency-Key': idem.current });
      if (confirm) await api.post(`${cfg.endpoint}/${saved.id}/confirm`);
      nav(`${cfg.basePath}/${saved.id}`);
    } catch (e) {
      const msg = errText(e);
      const text = confirm && saved ? `Saved as draft, but could not confirm: ${msg}` : msg;
      // Continue on the saved draft (keeps its id) and carry the reason across the navigation.
      if (saved && !id)
        nav(`${cfg.basePath}/${saved.id}/edit`, { replace: true, state: { notice: text } });
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
      <h1 className="text-xl font-semibold">
        {id ? 'Edit' : 'New'} {cfg.singular}
      </h1>
      {errors.length > 0 && (
        <ul role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="d-no">
            {cfg.noLabel} *
          </label>
          <input
            id="d-no"
            className="input"
            value={head[cfg.noField]}
            onChange={(e) => setH(cfg.noField, e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="d-date">
            Date *
          </label>
          <input
            id="d-date"
            type="date"
            className="input"
            max={today()}
            value={head.txnDate}
            onChange={(e) => setH('txnDate', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="d-party">
            {cfg.party.label} *
          </label>
          <select
            id="d-party"
            className="input"
            value={head.partyId}
            onChange={(e) => pickParty(e.target.value)}
          >
            <option value="">Select…</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.companyName}
              </option>
            ))}
          </select>
        </div>
        {cfg.extra.map((x) => (
          <div key={x.name} className={x.wide ? 'sm:col-span-3' : ''}>
            <label className="label" htmlFor={`d-${x.name}`}>
              {x.label}
            </label>
            <input
              id={`d-${x.name}`}
              className="input"
              value={head[x.name] ?? ''}
              onChange={(e) => setH(x.name, e.target.value)}
            />
          </div>
        ))}
        <div className="sm:col-span-3">
          <label className="label" htmlFor="d-rem">
            Remarks
          </label>
          <input
            id="d-rem"
            className="input"
            value={head.remarks}
            onChange={(e) => setH('remarks', e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border bg-white p-4">
        <h2 className="font-medium">Items</h2>
        {lines.map((l, i) => {
          const item = itemById.get(l.itemId);
          const have = avail.get(l.itemId) ?? 0;
          const short = cfg.lines.stockHint && item && Number(l.qty) > have;
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-12">
              <select
                className="input sm:col-span-4"
                aria-label={`Item ${i + 1}`}
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
                className="input sm:col-span-2"
                type="number"
                step="0.001"
                placeholder="Qty"
                aria-label={`Quantity ${i + 1}`}
                value={l.qty}
                onChange={(e) => upd(i, 'qty', e.target.value)}
              />
              <span className="self-center text-sm text-slate-500 sm:col-span-1">
                {item?.unit?.code ?? ''}
              </span>
              <input
                className="input sm:col-span-2"
                type="number"
                step="0.01"
                placeholder={cfg.lines.rate === 'required' ? 'Rate' : 'Rate (optional)'}
                aria-label={`Rate ${i + 1}`}
                value={l.rate}
                onChange={(e) => upd(i, 'rate', e.target.value)}
              />
              {cfg.lines.gst && (
                <input
                  className="input sm:col-span-1"
                  type="number"
                  step="0.01"
                  placeholder="GST %"
                  aria-label={`GST ${i + 1}`}
                  value={l.gstRate}
                  onChange={(e) => upd(i, 'gstRate', e.target.value)}
                />
              )}
              {cfg.lines.batch && (
                <input
                  className="input sm:col-span-1"
                  placeholder="Batch"
                  aria-label={`Batch ${i + 1}`}
                  value={l.batchNo}
                  onChange={(e) => upd(i, 'batchNo', e.target.value)}
                />
              )}
              <button
                type="button"
                className="btn-secondary sm:col-span-1"
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                aria-label={`Remove line ${i + 1}`}
              >
                ✕
              </button>
              {cfg.lines.stockHint && item && (
                <p
                  className={`text-xs sm:col-span-12 ${short ? 'font-medium text-red-600' : 'text-slate-500'}`}
                  data-testid={`hint-${i}`}
                >
                  Available (usable): {fmtQty(String(have))} {item.unit?.code}
                  {short ? ' — not enough stock for this quantity' : ''}
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setLines((ls) => [...ls, blankLine()])}
        >
          + Add item
        </button>
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
        <Link className="btn-secondary" to={cfg.basePath}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------------ detail */

export function DocDetail({ cfg }: { cfg: DocConfig }) {
  const { id } = useParams();
  const { hasRole } = useAuth();
  const [d, setD] = useState<Row | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<Row>(`${cfg.endpoint}/${id}`)
      .then(setD)
      .catch((e) => setMsg({ ok: false, text: errText(e) }));
  useEffect(() => {
    void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [id]);

  async function act(path: string, body?: unknown, okText?: string) {
    setBusy(true);
    setMsg(null);
    try {
      setD(await api.post<Row>(`${cfg.endpoint}/${id}/${path}`, body));
      if (okText) setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({
        ok: false,
        text: errText(e) + (e instanceof ApiError && e.status === 409 ? '' : ''),
      });
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    const reason = prompt(
      `Reason for cancelling ${d![cfg.noField]}?${d!.status === 'CONFIRMED' ? ' Stock will be reversed.' : ''}`,
    );
    if (reason) void act('cancel', { reason }, 'Cancelled.');
  }

  if (!d)
    return (
      <p className="text-slate-500">
        {msg ? '' : 'Loading…'}
        {msg && (
          <span role="alert" className="text-red-700">
            {msg.text}
          </span>
        )}
      </p>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">
          {cfg.singular} {d[cfg.noField]} <Status s={d.status} />
        </h1>
        {d.status === 'DRAFT' && hasRole('ADMIN', 'MANAGER', 'STORE') && (
          <>
            <Link className="btn-secondary" to={`${cfg.basePath}/${id}/edit`}>
              Edit
            </Link>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => void act('confirm', undefined, 'Confirmed — stock updated.')}
            >
              Confirm
            </button>
          </>
        )}
        {d.status !== 'CANCELLED' && hasRole('ADMIN', 'MANAGER') && (
          <button className="btn-danger" disabled={busy} onClick={cancel}>
            Cancel
          </button>
        )}
        {cfg.printable && d.status !== 'DRAFT' && (
          <Link className="btn-secondary" to={`${cfg.basePath}/${id}/print`}>
            Print
          </Link>
        )}
        <Link className="btn-secondary" to={cfg.basePath}>
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
      {d.status === 'CANCELLED' && (
        <p className="rounded bg-slate-100 p-2 text-sm">Cancelled: {d.cancelReason}</p>
      )}
      <dl className="grid gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-3">
        <Info k="Date" v={d.txnDate} />
        <Info k={cfg.party.label} v={d[cfg.party.rel]?.companyName} />
        <Info k="Warehouse" v={d.warehouse?.name} />
        {cfg.extra.map((x) => (
          <Info key={x.name} k={x.label} v={d[x.name]} />
        ))}
        <Info k="Remarks" v={d.remarks} />
        <Info k="Created by" v={d.createdBy?.name} />
      </dl>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              {[
                '#',
                'Item',
                'Qty',
                'Unit',
                'Rate',
                ...(cfg.lines.gst ? ['GST %'] : []),
                ...(cfg.lines.batch ? ['Batch'] : []),
                'Amount',
              ].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d.lines.map((l: Row) => (
              <tr key={l.id}>
                <td className="px-3 py-2">{l.lineNo}</td>
                <td className="px-3 py-2">
                  {l.item.code} — {l.item.name}
                </td>
                <td className="px-3 py-2 tabular-nums">{fmtQty(l.qty)}</td>
                <td className="px-3 py-2">{l.unit.code}</td>
                <td className="px-3 py-2 tabular-nums">{money(l.rate)}</td>
                {cfg.lines.gst && <td className="px-3 py-2">{Number(l.gstRate)}</td>}
                {cfg.lines.batch && <td className="px-3 py-2">{l.batchNo ?? '—'}</td>}
                <td className="px-3 py-2 text-right tabular-nums">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-right font-medium">
            {d.totals.taxable && (
              <tr>
                <td colSpan={cfg.lines.gst ? 7 : 5} className="px-3 py-1">
                  Taxable
                </td>
                <td className="px-3 py-1">{money(d.totals.taxable)}</td>
              </tr>
            )}
            {d.totals.gst && (
              <tr>
                <td colSpan={cfg.lines.gst ? 7 : 5} className="px-3 py-1">
                  GST
                </td>
                <td className="px-3 py-1">{money(d.totals.gst)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={cfg.lines.gst ? 7 : 5} className="px-3 py-1">
                Total
              </td>
              <td className="px-3 py-1">{money(d.totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
const Info = ({ k, v }: { k: string; v: unknown }) => (
  <div>
    <dt className="text-slate-500">{k}</dt>
    <dd className="font-medium">{v ? String(v) : '—'}</dd>
  </div>
);
