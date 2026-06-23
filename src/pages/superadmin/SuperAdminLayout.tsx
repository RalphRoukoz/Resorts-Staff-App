import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'

const navItems = [
  { to: '/superadmin/overview', label: 'Overview' },
  { to: '/superadmin/resorts', label: 'Resorts' },
  { to: '/superadmin/admins', label: 'Resort admins' },
]

export function SuperAdminLayout() {
  const { signOut } = useAuth()

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-violet-900/40 bg-violet-950/30 lg:flex">
        <div className="border-b border-violet-900/40 px-5 py-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
            Super Admin
          </p>
          <h1 className="mt-1 text-lg font-semibold text-white">Platform Console</h1>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-violet-600/25 text-violet-300'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-violet-900/40 p-3">
          <Button variant="ghost" fullWidth onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-violet-900/40 bg-violet-950/30 px-4 py-3 lg:hidden">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
              Super Admin
            </p>
            <p className="font-medium text-white">Platform Console</p>
          </div>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-violet-900/40 bg-violet-950/20 px-2 py-2 lg:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium ${
                  isActive ? 'bg-violet-600/25 text-violet-300' : 'text-slate-400'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
