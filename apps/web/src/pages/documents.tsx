import { dispatchSchema, procurementSchema } from '@inventory/shared';
import { DocDetail, DocEditor, DocList, type DocConfig } from '../components/DocPages';

export const procurementCfg: DocConfig = {
  kind: 'procurement',
  title: 'Procurement (GRN)',
  singular: 'GRN',
  basePath: '/procurement',
  endpoint: '/procurements',
  noField: 'grnNo',
  noLabel: 'GRN No',
  party: { field: 'supplierId', rel: 'supplier', label: 'Supplier', endpoint: '/suppliers' },
  schema: procurementSchema,
  extra: [],
  lines: { rate: 'required', gst: true, batch: true },
};

export const dispatchCfg: DocConfig = {
  kind: 'dispatch',
  title: 'Dispatch (Challan)',
  singular: 'Challan',
  basePath: '/dispatch',
  endpoint: '/dispatches',
  noField: 'challanNo',
  noLabel: 'Challan No',
  party: { field: 'clientId', rel: 'client', label: 'Client', endpoint: '/clients' },
  schema: dispatchSchema,
  extra: [
    { name: 'address', label: 'Delivery address', wide: true },
    { name: 'vehicleNo', label: 'Vehicle no.' },
    { name: 'driverName', label: 'Driver' },
    { name: 'salesOrderNo', label: 'Sales order' },
  ],
  lines: { rate: 'optional', stockHint: true },
  printable: true,
};

export const ProcurementList = () => <DocList cfg={procurementCfg} />;
export const ProcurementEdit = () => <DocEditor cfg={procurementCfg} />;
export const ProcurementDetail = () => <DocDetail cfg={procurementCfg} />;
export const DispatchList = () => <DocList cfg={dispatchCfg} />;
export const DispatchEdit = () => <DocEditor cfg={dispatchCfg} />;
export const DispatchDetail = () => <DocDetail cfg={dispatchCfg} />;
