import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Inventory from './pages/Inventory';
import OpeningStock from './pages/OpeningStock';
import ChallanPrint from './pages/ChallanPrint';
import {
  DispatchDetail,
  DispatchEdit,
  DispatchList,
  ProcurementDetail,
  ProcurementEdit,
  ProcurementList,
} from './pages/documents';
import { ConversionDetail, ConversionEditor, ConversionList } from './pages/Conversions';
import ConversionTemplates from './pages/ConversionTemplates';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import { CategoriesPage, ClientsPage, ItemsPage, SuppliersPage, UnitsPage } from './pages/masters';

const LATER: [string, string][] = [
  ['', 'Dashboard'],
  ['returns', 'Returns'],
  ['adjustments', 'Adjustments'],
  ['warehouses', 'Warehouses'],
  ['reports', 'Reports'],
  ['exports', 'Excel Exports'],
  ['audit-logs', 'Audit Logs'],
  ['users', 'Users'],
];

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-6 text-slate-500">Loading…</p>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route path="dispatch/:id/print" element={<ChallanPrint />} />
      <Route element={<Layout />}>
        <Route path="procurement" element={<ProcurementList />} />
        <Route path="procurement/new" element={<ProcurementEdit />} />
        <Route path="procurement/:id" element={<ProcurementDetail />} />
        <Route path="procurement/:id/edit" element={<ProcurementEdit />} />
        <Route path="conversions" element={<ConversionList />} />
        <Route path="conversions/templates" element={<ConversionTemplates />} />
        <Route path="conversions/new" element={<ConversionEditor />} />
        <Route path="conversions/:id" element={<ConversionDetail />} />
        <Route path="conversions/:id/edit" element={<ConversionEditor />} />
        <Route path="settings" element={<Settings />} />
        <Route path="dispatch" element={<DispatchList />} />
        <Route path="dispatch/new" element={<DispatchEdit />} />
        <Route path="dispatch/:id" element={<DispatchDetail />} />
        <Route path="dispatch/:id/edit" element={<DispatchEdit />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="opening-stock" element={<OpeningStock />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="units" element={<UnitsPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        {LATER.map(([path, title]) => (
          <Route key={path} path={path} element={<Placeholder title={title} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
