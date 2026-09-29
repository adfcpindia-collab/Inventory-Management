import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import { CategoriesPage, ClientsPage, ItemsPage, SuppliersPage, UnitsPage } from './pages/masters';

const LATER: [string, string][] = [
  ['', 'Dashboard'],
  ['inventory', 'Inventory'],
  ['procurement', 'Procurement'],
  ['dispatch', 'Dispatch'],
  ['conversions', 'Conversions'],
  ['returns', 'Returns'],
  ['adjustments', 'Adjustments'],
  ['warehouses', 'Warehouses'],
  ['reports', 'Reports'],
  ['exports', 'Excel Exports'],
  ['audit-logs', 'Audit Logs'],
  ['users', 'Users'],
  ['settings', 'Settings'],
];

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-6 text-slate-500">Loading…</p>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
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
