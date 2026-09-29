import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

// Sidebar order follows spec §25. Categories/Units sit under Items as sub-masters.
const NAV: { to: string; label: string; sub?: boolean }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/opening-stock', label: 'Opening Stock', sub: true },
  { to: '/items', label: 'Items' },
  { to: '/categories', label: 'Categories', sub: true },
  { to: '/units', label: 'Units', sub: true },
  { to: '/procurement', label: 'Procurement' },
  { to: '/dispatch', label: 'Dispatch' },
  { to: '/conversions', label: 'Conversions' },
  { to: '/returns', label: 'Returns' },
  { to: '/adjustments', label: 'Adjustments' },
  { to: '/warehouses', label: 'Warehouses' },
  { to: '/clients', label: 'Clients' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/reports', label: 'Reports' },
  { to: '/exports', label: 'Excel Exports' },
  { to: '/audit-logs', label: 'Audit Logs' },
  { to: '/users', label: 'Users' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen lg:flex">
      {open && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-60 transform overflow-y-auto bg-slate-900 p-4 text-slate-200 transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-6 px-2 text-lg font-semibold text-white">Inventory</div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${n.sub ? 'ml-4' : ''} ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-white px-4 py-3">
          <button
            className="btn-secondary lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden sm:inline text-slate-600">
              {user?.name} · <span className="font-medium">{user?.role}</span>
            </span>
            <button className="btn-secondary" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
