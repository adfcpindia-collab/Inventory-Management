import type { ReactNode } from 'react';
import { RecordDetail, RecordList, type Row } from '../../components/RecordViews';
import { fmtQty } from '../../lib';

const item = (l: Row) => `${l.item.code} — ${l.item.name}`;
const isMgr = (role: string) => role === 'ADMIN' || role === 'MANAGER';
const standardConfirm = (d: Row) => (d.status === 'DRAFT' ? 'Confirm' : null);

const CONDITION: Record<string, string> = {
  GOOD: 'Good → usable stock',
  DAMAGED: 'Damaged → damaged stock',
  NEEDS_INSPECTION: 'Needs inspection → inspection stock',
};
const ACTION: Record<string, string> = {
  DAMAGE: 'Damage (usable → damaged)',
  SCRAP: 'Scrap (remove damaged)',
  REPAIR: 'Repair (damaged → usable)',
};

/* ---------------------------------------------------------------- customer returns */
export const CustomerReturnList = () => (
  <RecordList
    title="Customer returns"
    singular="return"
    endpoint="/customer-returns"
    basePath="/returns/customer"
    columns={[
      { label: 'Return No', cell: (d) => d.returnNo },
      { label: 'Date', cell: (d) => d.txnDate },
      { label: 'Challan', cell: (d) => d.dispatch.challanNo },
      { label: 'Client', cell: (d) => d.client.companyName },
      { label: 'Qty', cell: (d) => fmtQty(d.totals.qty) },
    ]}
  />
);
export const CustomerReturnDetail = () => (
  <RecordDetail
    endpoint="/customer-returns"
    basePath="/returns/customer"
    heading={(d) => `Return ${d.returnNo}`}
    confirmLabel={standardConfirm}
    fields={(d) => [
      ['Date', d.txnDate],
      ['Original challan', d.dispatch.challanNo],
      ['Client', d.client.companyName],
      ['Warehouse', d.warehouse.name],
      ['Remarks', d.remarks],
      ['Created by', d.createdBy.name],
    ]}
    lines={{
      head: ['#', 'Item', 'Qty', 'Unit', 'Condition', 'Reason'],
      get: (d) => d.lines,
      row: (l) => [l.lineNo, item(l), fmtQty(l.qty), l.unit.code, CONDITION[l.condition], l.reason],
    }}
  />
);

/* ---------------------------------------------------------------- supplier returns */
export const SupplierReturnList = () => (
  <RecordList
    title="Supplier returns"
    singular="return"
    endpoint="/supplier-returns"
    basePath="/returns/supplier"
    columns={[
      { label: 'Return No', cell: (d) => d.returnNo },
      { label: 'Date', cell: (d) => d.txnDate },
      { label: 'GRN', cell: (d) => d.procurement.grnNo },
      { label: 'Supplier', cell: (d) => d.supplier.companyName },
      { label: 'Qty', cell: (d) => fmtQty(d.totals.qty) },
    ]}
  />
);
export const SupplierReturnDetail = () => (
  <RecordDetail
    endpoint="/supplier-returns"
    basePath="/returns/supplier"
    heading={(d) => `Return ${d.returnNo}`}
    confirmLabel={standardConfirm}
    fields={(d) => [
      ['Date', d.txnDate],
      ['Original GRN', d.procurement.grnNo],
      ['Supplier', d.supplier.companyName],
      ['Warehouse', d.warehouse.name],
      ['Remarks', d.remarks],
      ['Created by', d.createdBy.name],
    ]}
    lines={{
      head: ['#', 'Item', 'Qty', 'Unit', 'Taken from', 'Reason'],
      get: (d) => d.lines,
      row: (l) => [l.lineNo, item(l), fmtQty(l.qty), l.unit.code, l.stockStatus, l.reason],
    }}
  />
);

/* ------------------------------------------------------------ damage / scrap / repair */
export const StockActionList = () => (
  <RecordList
    title="Damage, scrap & repair"
    singular="entry"
    endpoint="/stock-actions"
    basePath="/returns/damage"
    columns={[
      { label: 'No', cell: (d) => d.actionNo },
      { label: 'Date', cell: (d) => d.txnDate },
      { label: 'Action', cell: (d) => d.action },
      { label: 'Item', cell: (d) => `${d.item.code} — ${d.item.name}` },
      { label: 'Qty', cell: (d) => fmtQty(d.qty) },
      { label: 'Reason', cell: (d) => d.reason },
    ]}
  />
);
export const StockActionDetail = () => (
  <RecordDetail
    endpoint="/stock-actions"
    basePath="/returns/damage"
    heading={(d) => `${d.action} ${d.actionNo}`}
    confirmLabel={standardConfirm}
    fields={(d) => [
      ['Date', d.txnDate],
      ['Action', ACTION[d.action]],
      ['Item', `${d.item.code} — ${d.item.name}`],
      ['Quantity', `${fmtQty(d.qty)} ${d.item.unit.code}`],
      ['Warehouse', d.warehouse.name],
      ['Reason', d.reason],
      ['Remarks', d.remarks],
      ['Created by', d.createdBy.name],
    ]}
  />
);

/* -------------------------------------------------------------------- adjustments */
export const AdjustmentList = () => (
  <RecordList
    title="Stock adjustments"
    singular="adjustment"
    endpoint="/stock-adjustments"
    basePath="/adjustments"
    columns={[
      { label: 'No', cell: (d) => d.adjustmentNo },
      { label: 'Date', cell: (d) => d.txnDate },
      { label: 'Item', cell: (d) => `${d.item.code} — ${d.item.name}` },
      { label: 'System', cell: (d) => fmtQty(d.systemQty) },
      { label: 'Physical', cell: (d) => fmtQty(d.physicalQty) },
      { label: 'Difference', cell: (d) => fmtQty(d.difference) },
      { label: 'Approval', cell: (d) => (d.status === 'DRAFT' ? d.approvalStatus : '') },
    ]}
  />
);
export const AdjustmentDetail = () => (
  <RecordDetail
    endpoint="/stock-adjustments"
    basePath="/adjustments"
    heading={(d) => `Adjustment ${d.adjustmentNo}`}
    // STORE can only request approval; a manager's confirm is the approval and posts to the ledger.
    confirmLabel={(d, role) =>
      d.status !== 'DRAFT'
        ? null
        : isMgr(role)
          ? 'Approve & post'
          : d.approvalStatus === 'PENDING'
            ? null
            : 'Request approval'
    }
    banner={(d): ReactNode =>
      d.status === 'DRAFT' && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">
          {d.approvalStatus === 'PENDING'
            ? 'Waiting for manager approval. No stock has changed yet.'
            : 'Draft. A manager must approve before stock changes.'}
        </p>
      )
    }
    fields={(d) => [
      ['Date', d.txnDate],
      ['Item', `${d.item.code} — ${d.item.name}`],
      ['Stock bucket', d.stockStatus],
      ['System qty (snapshot)', fmtQty(d.systemQty)],
      ['Physical qty', fmtQty(d.physicalQty)],
      [
        'Difference',
        `${Number(d.difference) > 0 ? '+' : ''}${fmtQty(d.difference)} ${d.item.unit.code}`,
      ],
      ['Reason', d.reason],
      ['Remarks', d.remarks],
      ['Warehouse', d.warehouse.name],
      ['Approval', d.approvalStatus],
      ['Created by', d.createdBy.name],
    ]}
  />
);
