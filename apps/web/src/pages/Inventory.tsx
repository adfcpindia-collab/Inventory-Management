import { useCallback, useEffect, useState } from 'react';
import { TXN_TYPES, type LedgerRow, type Paginated, type ReconcileResult } from '@inventory/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtQty, useItems } from '../lib';

const EMPTY = { itemId: '', from: '', to: '', type: '', reference: '', stockStatus: 'USABLE' };

export default function Inventory() {
  const { hasRole } = useAuth();
  const items = useItems();
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Paginated<LedgerRow> | null>(null);
  const [error, setError] = useState('');
  const [rec, setRec] = useState<ReconcileResult | null>(null);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const pageSize = 50;

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    try {
      setRes(await api.get<Paginated<LedgerRow>>(`/inventory/ledger?${p}`));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [f, page]);
  useEffect(() => {
    void load();
  }, [load]);

  const set =
    (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setF((v) => ({ ...v, [k]: e.target.value }));
      setPage(1);
    };
  const totalPages = Math.max(1, Math.ceil((res?.total ?? 0) / pageSize));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Inventory Ledger</h1>
        {hasRole('ADMIN', 'MANAGER') && (
          <button
            className="btn-secondary"
            onClick={() => void api.get<ReconcileResult>('/inventory/reconcile').then(setRec)}
          >
            Run reconciliation
          </button>
        )}
      </div>
      {rec && (
        <p
          role="status"
          className={`mb-3 rounded p-2 text-sm ${rec.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
        >
          {rec.ok
            ? `Reconciled: ${rec.balancesChecked} balances match the ledger.`
            : `MISMATCH: ${rec.mismatches.length} balance(s) differ from the ledger.`}
        </p>
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select className="input" aria-label="Item" value={f.itemId} onChange={set('itemId')}>
          <option value="">All items</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.code} — {i.name}
            </option>
          ))}
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
        <select
          className="input"
          aria-label="Transaction type"
          value={f.type}
          onChange={set('type')}
        >
          <option value="">All types</option>
          {TXN_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Reference / txn no."
          aria-label="Reference"
          value={f.reference}
          onChange={set('reference')}
        />
        <select
          className="input"
          aria-label="Stock bucket"
          value={f.stockStatus}
          onChange={set('stockStatus')}
        >
          <option value="USABLE">Usable</option>
          <option value="DAMAGED">Damaged</option>
          <option value="INSPECTION">Inspection</option>
          <option value="ALL">All buckets</option>
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
              {[
                'Date',
                'Type',
                'Reference',
                ...(f.itemId ? [] : ['Item']),
                'Opening',
                'In',
                'Out',
                'Balance',
                'User',
                'Remarks',
              ].map((h) => (
                <th
                  key={h}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${['Opening', 'In', 'Out', 'Balance'].includes(h) ? 'text-right' : ''}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {res?.data.map((r) => (
              <tr key={r.lineId}>
                <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.type.replace(/_/g, ' ')}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.reference}</td>
                {!f.itemId && (
                  <td className="whitespace-nowrap px-3 py-2">
                    {itemById.get(r.itemId)?.code ?? '—'}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.opening)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-green-700">
                  {Number(r.in) ? fmtQty(r.in) : ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-red-700">
                  {Number(r.out) ? fmtQty(r.out) : ''}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {fmtQty(r.balance)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{r.user}</td>
                <td className="px-3 py-2">{r.remarks}</td>
              </tr>
            ))}
            {res && res.data.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                  No ledger entries
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{res?.total ?? 0} entries</span>
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
