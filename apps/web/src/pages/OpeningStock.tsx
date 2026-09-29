import { useCallback, useEffect, useState } from 'react';
import { openingStockSchema, type ImportPreview } from '@inventory/shared';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { today, useItems } from '../lib';

interface Line {
  itemId: string;
  qty: string;
  unitCost: string;
  batchNo: string;
}
interface History {
  id: string;
  txnNo: string;
  txnDate: string;
  user: string;
  remarks: string | null;
  reversedBy: string | null;
  lines: {
    itemCode: string;
    itemName: string;
    warehouse: string;
    qty: string;
    batchNo: string | null;
  }[];
}
const blank = (): Line => ({ itemId: '', qty: '', unitCost: '', batchNo: '' });

export default function OpeningStock() {
  const { hasRole } = useAuth();
  const canWrite = hasRole('ADMIN', 'MANAGER');
  const items = useItems();
  const [history, setHistory] = useState<History[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [date, setDate] = useState(today());
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [errors, setErrors] = useState<string[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHistory = useCallback(() => {
    api
      .get<History[]>('/opening-stock')
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const fail = (e: unknown) =>
    setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' });

  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const parsed = openingStockSchema.safeParse({
      txnDate: date,
      remarks,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        unitCost: l.unitCost,
        batchNo: l.batchNo,
      })),
    });
    if (!parsed.success) {
      return setErrors(
        parsed.error.issues.map(
          (i) =>
            `${i.path.includes('lines') ? `Line ${Number(i.path[i.path.indexOf('lines') + 1]) + 1}: ` : ''}${i.message}`,
        ),
      );
    }
    setErrors([]);
    setBusy(true);
    try {
      await api.post('/opening-stock', parsed.data);
      setMsg({ ok: true, text: 'Opening stock saved.' });
      setLines([blank()]);
      setRemarks('');
      loadHistory();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!file) return;
    setMsg(null);
    setBusy(true);
    try {
      setPreview(
        await api.upload<ImportPreview>(`/opening-stock/import/preview?date=${date}`, file),
      );
    } catch (err) {
      setPreview(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!file) return;
    setBusy(true);
    try {
      await api.upload(`/opening-stock/import/confirm?date=${date}`, file);
      setMsg({ ok: true, text: `Imported ${preview?.validCount ?? 0} rows.` });
      setPreview(null);
      setFile(null);
      loadHistory();
    } catch (err) {
      const d =
        err instanceof ApiError
          ? (err as ApiError & { payload?: ImportPreview }).payload
          : undefined;
      if (d && 'rows' in d) setPreview(d);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function reverse(h: History) {
    const reason = prompt(`Reason for reversing ${h.txnNo}?`);
    if (!reason) return;
    try {
      await api.post(`/opening-stock/${h.id}/reverse`, { reason });
      setMsg({ ok: true, text: `${h.txnNo} reversed.` });
      loadHistory();
    } catch (err) {
      fail(err);
    }
  }

  const upd = (i: number, k: keyof Line, v: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Opening Stock</h1>
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={`rounded p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}
        >
          {msg.text}
        </p>
      )}
      {!canWrite && (
        <p className="text-sm text-slate-600">Only managers and admins can enter opening stock.</p>
      )}

      {canWrite && (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
            <div>
              <label className="label" htmlFor="os-date">
                Opening date
              </label>
              <input
                id="os-date"
                type="date"
                className="input"
                value={date}
                max={today()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <p className="text-sm text-slate-500">
              Applies to manual entry and imports. Existing opening stock is never overwritten.
            </p>
          </div>

          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-3 font-medium">Manual entry</h2>
            <form onSubmit={saveManual} noValidate className="space-y-3">
              {errors.length > 0 && (
                <ul role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                  <select
                    className="input"
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
                          {it.unit ? ` (${it.unit.code})` : ''}
                        </option>
                      ))}
                  </select>
                  <input
                    className="input"
                    type="number"
                    step="0.001"
                    placeholder="Quantity"
                    aria-label={`Quantity ${i + 1}`}
                    value={l.qty}
                    onChange={(e) => upd(i, 'qty', e.target.value)}
                  />
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder="Unit cost"
                    aria-label={`Unit cost ${i + 1}`}
                    value={l.unitCost}
                    onChange={(e) => upd(i, 'unitCost', e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Batch (optional)"
                    aria-label={`Batch ${i + 1}`}
                    value={l.batchNo}
                    onChange={(e) => upd(i, 'batchNo', e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    aria-label={`Remove line ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <input
                className="input"
                placeholder="Remarks (optional)"
                aria-label="Remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setLines((ls) => [...ls, blank()])}
                >
                  + Add line
                </button>
                <button className="btn-primary" disabled={busy}>
                  Save opening stock
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-lg border bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto font-medium">Excel import</h2>
              <button
                className="btn-secondary"
                onClick={() =>
                  void api
                    .download('/opening-stock/template', 'opening-stock-template.xlsx')
                    .catch(fail)
                }
              >
                Download template
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept=".xlsx"
                aria-label="Excel file"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
              <button
                className="btn-secondary"
                disabled={!file || busy}
                onClick={() => void runPreview()}
              >
                Preview
              </button>
              <button
                className="btn-primary"
                disabled={!preview?.canConfirm || busy}
                onClick={() => void confirmImport()}
              >
                Confirm import
              </button>
            </div>
            {preview && (
              <div className="mt-3">
                <p className="mb-2 text-sm">
                  <span className="text-green-700">{preview.validCount} valid</span> ·{' '}
                  <span className={preview.errorCount ? 'text-red-700' : ''}>
                    {preview.errorCount} with errors
                  </span>
                  {!preview.canConfirm &&
                    ' — fix the file and preview again; nothing is saved until every row is valid.'}
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-slate-600">
                      <tr>
                        {['Row', 'Item', 'Qty', 'Warehouse', 'Batch', 'Result'].map((h) => (
                          <th key={h} className="px-2 py-1 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.row} className={r.errors.length ? 'bg-red-50' : ''}>
                          <td className="px-2 py-1">{r.row}</td>
                          <td className="px-2 py-1">
                            {r.itemCode}
                            {r.itemName ? ` — ${r.itemName}` : ''}
                          </td>
                          <td className="px-2 py-1">{r.qty ?? ''}</td>
                          <td className="px-2 py-1">{r.warehouseCode ?? ''}</td>
                          <td className="px-2 py-1">{r.batchNo ?? ''}</td>
                          <td className="px-2 py-1 text-red-700">
                            {r.errors.length ? (
                              r.errors.join('; ')
                            ) : (
                              <span className="text-green-700">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      <section>
        <h2 className="mb-2 font-medium">Opening stock entries</h2>
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                {['Txn', 'Date', 'Lines', 'By', 'Status', ''].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.id} className={h.reversedBy ? 'text-slate-400' : ''}>
                  <td className="whitespace-nowrap px-3 py-2">{h.txnNo}</td>
                  <td className="whitespace-nowrap px-3 py-2">{h.txnDate}</td>
                  <td className="px-3 py-2">
                    {h.lines.map((l) => `${l.itemCode} × ${Number(l.qty)}`).join(', ')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{h.user}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {h.reversedBy ? `Reversed (${h.reversedBy})` : 'Confirmed'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && !h.reversedBy && (
                      <button className="btn-danger" onClick={() => void reverse(h)}>
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    No opening stock entered yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
