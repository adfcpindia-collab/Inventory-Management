import {
  PRODUCT_TYPES,
  TRACKING_TYPES,
  categorySchema,
  clientSchema,
  itemSchema,
  supplierSchema,
  unitSchema,
} from '@inventory/shared';
import MasterPage, { type FieldDef, type MasterConfig } from '../components/MasterPage';

const opts = (vals: readonly string[]) =>
  vals.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

const partyFields: FieldDef[] = [
  { name: 'companyName', label: 'Company name', required: true },
  { name: 'contactPerson', label: 'Contact person' },
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email' },
  { name: 'gstin', label: 'GSTIN' },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'remarks', label: 'Remarks', type: 'textarea' },
];
const partyColumns = [
  { label: 'Company', render: (r: Record<string, string>) => r.companyName },
  { label: 'Contact', render: (r: Record<string, string>) => r.contactPerson ?? '—' },
  { label: 'Phone', render: (r: Record<string, string>) => r.phone ?? '—' },
  { label: 'GSTIN', render: (r: Record<string, string>) => r.gstin ?? '—' },
];

const num = (v: unknown) => (v == null ? '' : String(Number(v)));

const items: MasterConfig = {
  title: 'Items',
  endpoint: '/items',
  schema: itemSchema,
  defaults: {
    productType: 'FINISHED_GOOD',
    trackingType: 'NONE',
    minLevel: 0,
    reorderLevel: 0,
    maxLevel: 0,
    gstRate: 0,
    purchasePrice: 0,
    sellingPrice: 0,
  },
  columns: [
    { label: 'Code', render: (r) => r.code },
    { label: 'Name', render: (r) => r.name },
    { label: 'Category', render: (r) => r.category?.name },
    { label: 'Unit', render: (r) => r.unit?.code },
    { label: 'Min', render: (r) => num(r.minLevel) },
    { label: 'Reorder', render: (r) => num(r.reorderLevel) },
    { label: 'GST %', render: (r) => num(r.gstRate) },
  ],
  toForm: (r) => ({
    ...r,
    minLevel: num(r.minLevel),
    reorderLevel: num(r.reorderLevel),
    maxLevel: num(r.maxLevel),
    gstRate: num(r.gstRate),
    purchasePrice: num(r.purchasePrice),
    sellingPrice: num(r.sellingPrice),
  }),
  fields: [
    { name: 'code', label: 'Item code / SKU', required: true },
    { name: 'name', label: 'Name', required: true },
    {
      name: 'categoryId',
      label: 'Category',
      type: 'select',
      required: true,
      optionsFrom: { endpoint: '/categories', label: (r) => r.name },
    },
    { name: 'subcategory', label: 'Subcategory' },
    {
      name: 'unitId',
      label: 'Unit',
      type: 'select',
      required: true,
      optionsFrom: { endpoint: '/units', label: (r) => `${r.code} — ${r.name}` },
    },
    {
      name: 'productType',
      label: 'Product type',
      type: 'select',
      required: true,
      options: opts(PRODUCT_TYPES),
    },
    { name: 'trackingType', label: 'Tracking', type: 'select', options: opts(TRACKING_TYPES) },
    { name: 'hsnSac', label: 'HSN / SAC' },
    { name: 'minLevel', label: 'Minimum level', type: 'number', step: '0.001' },
    { name: 'reorderLevel', label: 'Reorder level', type: 'number', step: '0.001' },
    { name: 'maxLevel', label: 'Maximum level', type: 'number', step: '0.001' },
    { name: 'gstRate', label: 'GST rate %', type: 'number', step: '0.01' },
    { name: 'purchasePrice', label: 'Purchase price', type: 'number', step: '0.01' },
    { name: 'sellingPrice', label: 'Selling price', type: 'number', step: '0.01' },
    { name: 'description', label: 'Description', type: 'textarea' },
  ],
};

const clients: MasterConfig = {
  title: 'Clients',
  endpoint: '/clients',
  schema: clientSchema,
  columns: partyColumns,
  fields: partyFields,
};
const suppliers: MasterConfig = {
  title: 'Suppliers',
  endpoint: '/suppliers',
  schema: supplierSchema,
  columns: partyColumns,
  fields: partyFields,
};
const categories: MasterConfig = {
  title: 'Categories',
  endpoint: '/categories',
  schema: categorySchema,
  columns: [
    { label: 'Name', render: (r) => r.name },
    { label: 'Description', render: (r) => r.description ?? '—' },
  ],
  fields: [
    { name: 'name', label: 'Name', required: true },
    { name: 'description', label: 'Description', type: 'textarea' },
  ],
};
const units: MasterConfig = {
  title: 'Units',
  endpoint: '/units',
  schema: unitSchema,
  columns: [
    { label: 'Code', render: (r) => r.code },
    { label: 'Name', render: (r) => r.name },
  ],
  fields: [
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Name', required: true },
  ],
};

export const ItemsPage = () => <MasterPage cfg={items} />;
export const ClientsPage = () => <MasterPage cfg={clients} />;
export const SuppliersPage = () => <MasterPage cfg={suppliers} />;
export const CategoriesPage = () => <MasterPage cfg={categories} />;
export const UnitsPage = () => <MasterPage cfg={units} />;
