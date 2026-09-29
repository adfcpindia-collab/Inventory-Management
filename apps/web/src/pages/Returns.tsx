import { NavLink, Navigate, Outlet } from 'react-router-dom';

const TABS: [string, string][] = [
  ['/returns/customer', 'Customer returns'],
  ['/returns/supplier', 'Supplier returns'],
  ['/returns/damage', 'Damage, scrap & repair'],
];

/** Tab strip shared by the returns / damage screens. */
export function ReturnsLayout() {
  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-sm ${isActive ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
export const ReturnsIndex = () => <Navigate to="/returns/customer" replace />;
