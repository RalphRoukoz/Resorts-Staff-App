import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'

const navItems = [
  { to: '/admin/chalets', label: 'Chalets' },
  { to: '/admin/rentals', label: 'Rentals' },
  { to: '/admin/today', label: 'Today & Consumption' },
  { to: '/admin/anti-resale', label: 'Anti-resale' },
  { to: '/admin/reception-staff', label: 'Reception staff' },
  { to: '/admin/settings', label: 'Settings' },
]

export function AdminLayout() {
  const { resort, hasReception, signOut, setView } = useAuth()
  const navigate = useNavigate()

  function openScanner() {
    setView('reception')
    navigate('/scanner')
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 lg:flex">
        <div className="border-b border-slate-800 px-5 py-6">
          <p className="text-xs font-medium uppercase tracking-widest text-sky-400">
            Admin
          </p>
          <h1 className="mt-1 text-lg font-semibold text-white">
            {resort?.name ?? 'Resort'}
          </h1>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-sky-600/20 text-sky-300'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-2 border-t border-slate-800 p-3">
          {hasReception ? (
            <Button variant="secondary" fullWidth onClick={openScanner}>
              Open scanner
            </Button>
          ) : null}
          <Button variant="ghost" fullWidth onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 lg:hidden">
          <div>
            <p className="text-xs uppercase tracking-widest text-sky-400">Admin</p>
            <p className="font-medium text-white">{resort?.name ?? 'Resort'}</p>
          </div>
          <div className="flex gap-2">
            {hasReception ? (
              <Button variant="secondary" onClick={openScanner}>
                Scanner
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => void signOut()}>
              Out
            </Button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900 px-2 py-2 lg:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium ${
                  isActive ? 'bg-sky-600/20 text-sky-300' : 'text-slate-400'
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
