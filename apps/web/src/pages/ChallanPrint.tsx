import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';

/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (v: unknown) =>
  v == null
    ? ''
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Printable delivery challan. Use the browser's Print → "Save as PDF" for a PDF copy. */
export default function ChallanPrint() {
  const { id } = useParams();
  const [d, setD] = useState<any>(null);
  const [company, setCompany] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api.get<any>(`/dispatches/${id}`), api.get<{ name: string }>('/company')])
      .then(([doc, c]) => {
        setD(doc);
        setCompany(c.name);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [id]);
  if (error)
    return (
      <p role="alert" className="p-6 text-red-700">
        {error}
      </p>
    );
  if (!d) return <p className="p-6 text-slate-500">Loading…</p>;
  const qtyTotal = d.lines.reduce((a: number, l: any) => a + Number(l.qty), 0);
  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-sm print:max-w-none print:p-0">
      <div className="mb-4 flex gap-2 print:hidden">
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        <Link className="btn-secondary" to={`/dispatch/${id}`}>
          Back
        </Link>
      </div>
      <header className="mb-4 flex items-start justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-bold">{company}</h1>
          <p className="text-slate-600">Delivery Challan</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">{d.challanNo}</p>
          <p>Date: {d.txnDate}</p>
          {d.status === 'CANCELLED' && <p className="font-bold text-red-700">CANCELLED</p>}
        </div>
      </header>
      <section className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <p className="font-semibold">Deliver to</p>
          <p>{d.client.companyName}</p>
          <p className="whitespace-pre-line">{d.address}</p>
          {d.client.gstin && <p>GSTIN: {d.client.gstin}</p>}
        </div>
        <div>
          {d.salesOrderNo && <p>Sales order: {d.salesOrderNo}</p>}
          {d.vehicleNo && <p>Vehicle: {d.vehicleNo}</p>}
          {d.driverName && <p>Driver: {d.driverName}</p>}
          <p>From: {d.warehouse.name}</p>
        </div>
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y bg-slate-50 text-left">
            {['#', 'Item', 'Qty', 'Unit', 'Rate', 'Amount'].map((h) => (
              <th key={h} className="px-2 py-1">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l: any) => (
            <tr key={l.id} className="border-b">
              <td className="px-2 py-1">{l.lineNo}</td>
              <td className="px-2 py-1">
                {l.item.code} — {l.item.name}
              </td>
              <td className="px-2 py-1">{Number(l.qty)}</td>
              <td className="px-2 py-1">{l.unit.code}</td>
              <td className="px-2 py-1">{money(l.rate)}</td>
              <td className="px-2 py-1 text-right">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={2} className="px-2 py-1 text-right">
              Total qty
            </td>
            <td className="px-2 py-1">{qtyTotal}</td>
            <td colSpan={2} className="px-2 py-1 text-right">
              Total
            </td>
            <td className="px-2 py-1 text-right">
              {d.totals.total !== '0.00' ? money(d.totals.total) : ''}
            </td>
          </tr>
        </tfoot>
      </table>
      {d.remarks && <p className="mt-3">Remarks: {d.remarks}</p>}
      <footer className="mt-16 grid grid-cols-2 gap-8 text-center">
        <div className="border-t pt-1">Receiver's signature</div>
        <div className="border-t pt-1">Authorised signatory</div>
      </footer>
    </div>
  );
}
