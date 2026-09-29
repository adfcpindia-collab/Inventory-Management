import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  customerReturnSchema,
  RETURN_CONDITIONS,
  STOCK_ACTIONS,
  stockActionSchema,
  stockAdjustmentSchema,
  supplierReturnSchema,
  type Paginated,
} from '@inventory/shared';
import { api } from '../../api';
import { ErrorList, useRecordSave, type Row } from '../../components/RecordViews';
import { fmtQty, today, useItems } from '../../lib';

const Field = ({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) => (
  <label className={`block ${wide ? 'sm:col-span-3' : ''}`}>
    <span className="label">{label}</span>
    {children}
  </label>
);

function Shell({
  title,
  base,
  errors,
  busy,
  onSave,
  confirmText,
  children,
}: {
  title: string;
  base: string;
  errors: string[];
  busy: boolean;
  onSave: (confirm: boolean) => void;
  confirmText: string;
  children: ReactNode;
}) {
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSave(false);
      }}
    >
      <h1 className="text-xl font-semibold">{title}</h1>
      <ErrorList errors={errors} />
      {children}
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={busy}>
          Save draft
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => onSave(true)}>
          {confirmText}
        </button>
        <Link className="btn-secondary" to={base}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

interface ReturnLine {
  itemId: string;
  qty: string;
  variant: string; // condition (customer) or stock bucket (supplier)
  reason: string;
}

/** Return editor shared by customer (against a challan) and supplier (against a GRN) returns. */
function ReturnEditor({ kind }: { kind: 'customer' | 'supplier' }) {
  const { id } = useParams();
  const cust = kind === 'customer';
  const cfg = cust
    ? {
        endpoint: '/customer-returns',
        base: '/returns/customer',
        schema: customerReturnSchema,
        srcEndpoint: '/dispatches',
        srcField: 'dispatchId',
        srcNo: 'challanNo',
        srcLabel: 'Original challan',
        party: 'client',
        defaultVariant: 'GOOD',
      }
    : {
        endpoint: '/supplier-returns',
        base: '/returns/supplier',
        schema: supplierReturnSchema,
        srcEndpoint: '/procurements',
        srcField: 'procurementId',
        srcNo: 'grnNo',
        srcLabel: 'Original GRN',
        party: 'supplier',
        defaultVariant: 'USABLE',
      };
  const variantKey = cust ? 'condition' : 'stockStatus';
  const { save, errors, busy, setErrors } = useRecordSave({
    endpoint: cfg.endpoint,
    basePath: cfg.base,
    schema: cfg.schema,
    id,
  });
  const items = useItems();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [sources, setSources] = useState<Row[]>([]);
  const [src, setSrc] = useState<Row | null>(null);
  const [head, setHead] = useState({ returnNo: '', txnDate: today(), remarks: '' });
  const [srcId, setSrcId] = useState('');
  const [lines, setLines] = useState<ReturnLine[]>([]);

  useEffect(() => {
    api
      .get<Paginated<Row>>(`${cfg.srcEndpoint}?status=CONFIRMED&pageSize=200`)
      .then((r) => setSources(r.data))
      .catch(() => undefined);
  }, [cfg.srcEndpoint]);

  const blank = (itemId: string): ReturnLine => ({
    itemId,
    qty: '',
    variant: cfg.defaultVariant,
    reason: '',
  });
  async function pick(sid: string) {
    setSrcId(sid);
    if (!sid) return (setSrc(null), setLines([]));
    const d = await api.get<Row>(`${cfg.srcEndpoint}/${sid}`);
    setSrc(d);
    setLines(d.lines.map((l: Row) => blank(l.itemId)));
  }

  useEffect(() => {
    if (!id) return;
    api
      .get<Row>(`${cfg.endpoint}/${id}`)
      .then(async (d) => {
        setHead({ returnNo: d.returnNo, txnDate: d.txnDate, remarks: d.remarks ?? '' });
        const s = await api.get<Row>(`${cfg.srcEndpoint}/${d[cfg.srcField]}`);
        setSrcId(s.id);
        setSrc(s);
        setLines(
          d.lines.map((l: Row) => ({
            itemId: l.itemId,
            qty: String(Number(l.qty)),
            variant: l[variantKey],
            reason: l.reason ?? '',
          })),
        );
      })
      .catch((e) => setErrors([e instanceof Error ? e.message : 'Failed']));
  }, [id, cfg.endpoint, cfg.srcEndpoint, cfg.srcField, variantKey, setErrors]);

  const upd = (i: number, k: keyof ReturnLine, v: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const dispatched = (itemId: string) =>
    (src?.lines ?? [])
      .filter((l: Row) => l.itemId === itemId)
      .reduce((a: number, l: Row) => a + Number(l.qty), 0);

  const submit = (confirm: boolean) =>
    save(
      {
        returnNo: head.returnNo,
        txnDate: head.txnDate,
        [cfg.srcField]: srcId,
        remarks: head.remarks,
        // Rows left blank are simply not part of the return.
        lines: lines
          .filter((l) => l.qty !== '')
          .map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            [variantKey]: l.variant,
            reason: l.reason,
          })),
      },
      confirm,
    );

  return (
    <Shell
      title={`${id ? 'Edit' : 'New'} ${cust ? 'customer' : 'supplier'} return`}
      base={cfg.base}
      errors={errors}
      busy={busy}
      onSave={(c) => void submit(c)}
      confirmText="Save & confirm"
    >
      <div className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3">
        <Field label="Return no *">
          <input
            className="input"
            value={head.returnNo}
            onChange={(e) => setHead({ ...head, returnNo: e.target.value })}
          />
        </Field>
        <Field label="Date *">
          <input
            type="date"
            className="input"
            max={today()}
            value={head.txnDate}
            onChange={(e) => setHead({ ...head, txnDate: e.target.value })}
          />
        </Field>
        <Field label={`${cfg.srcLabel} *`}>
          <select
            className="input"
            value={srcId}
            disabled={!!id}
            onChange={(e) => void pick(e.target.value)}
          >
            <option value="">Select…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s[cfg.srcNo]} · {s[cfg.party]?.companyName} · {s.txnDate}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Remarks" wide>
          <input
            className="input"
            value={head.remarks}
            onChange={(e) => setHead({ ...head, remarks: e.target.value })}
          />
        </Field>
      </div>
      {src && (
        <div className="space-y-2 rounded-lg border bg-white p-4">
          <h2 className="font-medium">Items — enter a quantity for each item being returned</h2>
          {lines.map((l, i) => {
            const it = itemById.get(l.itemId);
            const firstOfItem = lines.findIndex((x) => x.itemId === l.itemId) === i;
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-12">
                <span className="self-center text-sm sm:col-span-3">
                  {it ? `${it.code} — ${it.name}` : l.itemId}
                </span>
                <span className="self-center text-xs text-slate-500 sm:col-span-2">
                  {cust ? 'Dispatched' : 'Received'}: {fmtQty(String(dispatched(l.itemId)))}{' '}
                  {it?.unit?.code}
                </span>
                <input
                  className="input sm:col-span-2"
                  type="number"
                  step="0.001"
                  placeholder="Return qty"
                  aria-label={`Return quantity ${i + 1}`}
                  value={l.qty}
                  onChange={(e) => upd(i, 'qty', e.target.value)}
                />
                <select
                  className="input sm:col-span-2"
                  aria-label={cust ? `Condition ${i + 1}` : `Stock bucket ${i + 1}`}
                  value={l.variant}
                  onChange={(e) => upd(i, 'variant', e.target.value)}
                >
                  {cust ? (
                    RETURN_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c.replace('_', ' ')}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="USABLE">From usable stock</option>
                      <option value="DAMAGED">From damaged stock</option>
                    </>
                  )}
                </select>
                <input
                  className="input sm:col-span-2"
                  placeholder="Reason"
                  aria-label={`Reason ${i + 1}`}
                  value={l.reason}
                  onChange={(e) => upd(i, 'reason', e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary sm:col-span-1"
                  title={
                    firstOfItem
                      ? 'Split into another row (e.g. part good, part damaged)'
                      : 'Remove row'
                  }
                  onClick={() =>
                    setLines((ls) =>
                      firstOfItem
                        ? [...ls.slice(0, i + 1), blank(l.itemId), ...ls.slice(i + 1)]
                        : ls.filter((_, j) => j !== i),
                    )
                  }
                  aria-label={firstOfItem ? `Split line ${i + 1}` : `Remove line ${i + 1}`}
                >
                  {firstOfItem ? '＋' : '✕'}
                </button>
              </div>
            );
          })}
          {cust && (
            <p className="text-xs text-slate-500">
              Only GOOD goes back into usable stock. Damaged goods and goods needing inspection are
              kept in their own buckets and can never be dispatched until moved by a later action.
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}
export const CustomerReturnEditor = () => <ReturnEditor kind="customer" />;
export const SupplierReturnEditor = () => <ReturnEditor kind="supplier" />;

/** Current cached balances → available quantity per (item, bucket). */
function useBalances() {
  const [m, setM] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    api
      .get<Row[]>('/inventory/balances')
      .then((rows) => {
        const next = new Map<string, number>();
        rows.forEach((r) => {
          const k = `${r.itemId}|${r.stockStatus}`;
          next.set(k, (next.get(k) ?? 0) + Number(r.qty));
        });
        setM(next);
      })
      .catch(() => undefined);
  }, []);
  return (itemId: string, bucket: string) => m.get(`${itemId}|${bucket}`) ?? 0;
}

const SOURCE_BUCKET = { DAMAGE: 'USABLE', SCRAP: 'DAMAGED', REPAIR: 'DAMAGED' } as const;

export function StockActionEditor() {
  const { id } = useParams();
  const { save, errors, busy, setErrors } = useRecordSave({
    endpoint: '/stock-actions',
    basePath: '/returns/damage',
    schema: stockActionSchema,
    id,
  });
  const items = useItems();
  const have = useBalances();
  const [f, setF] = useState({
    action: 'DAMAGE',
    txnDate: today(),
    itemId: '',
    qty: '',
    reason: '',
    remarks: '',
  });
  useEffect(() => {
    if (!id) return;
    api
      .get<Row>(`/stock-actions/${id}`)
      .then((d) =>
        setF({
          action: d.action,
          txnDate: d.txnDate,
          itemId: d.itemId,
          qty: String(Number(d.qty)),
          reason: d.reason,
          remarks: d.remarks ?? '',
        }),
      )
      .catch((e) => setErrors([e instanceof Error ? e.message : 'Failed']));
  }, [id, setErrors]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const bucket = SOURCE_BUCKET[f.action as keyof typeof SOURCE_BUCKET];
  const available = f.itemId ? have(f.itemId, bucket) : 0;
  return (
    <Shell
      title={`${id ? 'Edit' : 'New'} damage / scrap / repair`}
      base="/returns/damage"
      errors={errors}
      busy={busy}
      onSave={(c) => void save(f, c)}
      confirmText="Save & confirm"
    >
      <div className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3">
        <Field label="Action *">
          <select
            className="input"
            value={f.action}
            onChange={(e) => set('action', e.target.value)}
          >
            {STOCK_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a === 'DAMAGE'
                  ? 'Damage (usable → damaged)'
                  : a === 'SCRAP'
                    ? 'Scrap (remove damaged)'
                    : 'Repair (damaged → usable)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date *">
          <input
            type="date"
            className="input"
            max={today()}
            value={f.txnDate}
            onChange={(e) => set('txnDate', e.target.value)}
          />
        </Field>
        <Field label="Item *">
          <select
            className="input"
            value={f.itemId}
            onChange={(e) => set('itemId', e.target.value)}
          >
            <option value="">Select item…</option>
            {items
              .filter((i) => i.active)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} — {i.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Quantity *">
          <input
            className="input"
            type="number"
            step="0.001"
            value={f.qty}
            onChange={(e) => set('qty', e.target.value)}
          />
          {f.itemId && (
            <span
              className={`text-xs ${Number(f.qty) > available ? 'font-medium text-red-600' : 'text-slate-500'}`}
            >
              Available ({bucket.toLowerCase()}): {fmtQty(String(available))}
            </span>
          )}
        </Field>
        <Field label="Reason *" wide>
          <input
            className="input"
            value={f.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
        </Field>
        <Field label="Remarks" wide>
          <input
            className="input"
            value={f.remarks}
            onChange={(e) => set('remarks', e.target.value)}
          />
        </Field>
      </div>
    </Shell>
  );
}

export function AdjustmentEditor() {
  const { id } = useParams();
  const { save, errors, busy, setErrors } = useRecordSave({
    endpoint: '/stock-adjustments',
    basePath: '/adjustments',
    schema: stockAdjustmentSchema,
    id,
  });
  const items = useItems();
  const have = useBalances();
  const [f, setF] = useState({
    txnDate: today(),
    itemId: '',
    stockStatus: 'USABLE',
    physicalQty: '',
    reason: '',
    remarks: '',
  });
  useEffect(() => {
    if (!id) return;
    api
      .get<Row>(`/stock-adjustments/${id}`)
      .then((d) =>
        setF({
          txnDate: d.txnDate,
          itemId: d.itemId,
          stockStatus: d.stockStatus,
          physicalQty: String(Number(d.physicalQty)),
          reason: d.reason,
          remarks: d.remarks ?? '',
        }),
      )
      .catch((e) => setErrors([e instanceof Error ? e.message : 'Failed']));
  }, [id, setErrors]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const system = f.itemId ? have(f.itemId, f.stockStatus) : null;
  const diff = system !== null && f.physicalQty !== '' ? Number(f.physicalQty) - system : null;
  return (
    <Shell
      title={`${id ? 'Edit' : 'New'} stock adjustment`}
      base="/adjustments"
      errors={errors}
      busy={busy}
      onSave={(c) => void save(f, c)}
      confirmText="Save & request approval"
    >
      <div className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3">
        <Field label="Date *">
          <input
            type="date"
            className="input"
            max={today()}
            value={f.txnDate}
            onChange={(e) => set('txnDate', e.target.value)}
          />
        </Field>
        <Field label="Item *">
          <select
            className="input"
            value={f.itemId}
            onChange={(e) => set('itemId', e.target.value)}
          >
            <option value="">Select item…</option>
            {items
              .filter((i) => i.active)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} — {i.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Stock bucket">
          <select
            className="input"
            value={f.stockStatus}
            onChange={(e) => set('stockStatus', e.target.value)}
          >
            <option value="USABLE">Usable</option>
            <option value="DAMAGED">Damaged</option>
            <option value="INSPECTION">Inspection</option>
          </select>
        </Field>
        <Field label="Physical quantity counted *">
          <input
            className="input"
            type="number"
            step="0.001"
            value={f.physicalQty}
            onChange={(e) => set('physicalQty', e.target.value)}
          />
        </Field>
        <div className="self-end text-sm" data-testid="adj-preview">
          {system !== null && (
            <>
              System: <b>{fmtQty(String(system))}</b>
              {diff !== null && (
                <>
                  {' '}
                  · Difference:{' '}
                  <b
                    className={
                      diff === 0 ? 'text-slate-500' : diff > 0 ? 'text-green-700' : 'text-red-700'
                    }
                  >
                    {diff > 0 ? '+' : ''}
                    {fmtQty(String(diff))}
                  </b>
                </>
              )}
              <div className="text-xs text-slate-500">
                The server takes its own snapshot when saved.
              </div>
            </>
          )}
        </div>
        <Field label="Reason *" wide>
          <input
            className="input"
            value={f.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
        </Field>
        <Field label="Remarks" wide>
          <input
            className="input"
            value={f.remarks}
            onChange={(e) => set('remarks', e.target.value)}
          />
        </Field>
      </div>
    </Shell>
  );
}
