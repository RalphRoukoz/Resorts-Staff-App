import type { CSSProperties } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'

const DEFAULT_BRAND = '#0ea5e9'

const navItems = [
  { to: '/admin/units', label: 'Chalets & Cabines' },
  { to: '/admin/rentals', label: 'Rentals' },
  { to: '/admin/today', label: 'Today & Consumption' },
  { to: '/admin/analytics', label: 'Analytics' },
  { to: '/admin/announcements', label: 'Announcements' },
  { to: '/admin/reception-staff', label: 'Reception staff' },
  { to: '/admin/configuration', label: 'Resort Configuration' },
]

export function AdminLayout() {
  const { resort, hasReception, signOut, setView } = useAuth()
  const navigate = useNavigate()

  const brand = resort?.primary_color || DEFAULT_BRAND

  function openScanner() {
    setView('reception')
    navigate('/scanner')
  }

  function navLinkStyle({ isActive }: { isActive: boolean }): CSSProperties {
    return isActive ? { backgroundColor: `${brand}22`, color: brand } : {}
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
      isActive ? '' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`

  function BrandMark() {
    if (resort?.logo_url) {
      return (
        <img
          src={resort.logo_url}
          alt={resort?.name ?? 'Resort'}
          className="h-10 w-auto max-w-[180px] object-contain"
        />
      )
    }
    return (
      <>
        <p className="text-xs font-medium uppercase tracking-widest" style={{ color: brand }}>
          Admin
        </p>
        <h1 className="mt-1 text-lg font-semibold text-white">{resort?.name ?? 'Resort'}</h1>
      </>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 lg:flex">
        <div className="border-b border-slate-800 px-5 py-6">
          <BrandMark />
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass} style={navLinkStyle}>
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
          <div className="flex items-center gap-3">
            {resort?.logo_url ? (
              <img
                src={resort.logo_url}
                alt={resort?.name ?? 'Resort'}
                className="h-8 w-auto max-w-[120px] object-contain"
              />
            ) : (
              <div>
                <p className="text-xs uppercase tracking-widest" style={{ color: brand }}>
                  Admin
                </p>
                <p className="font-medium text-white">{resort?.name ?? 'Resort'}</p>
              </div>
            )}
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
                  isActive ? '' : 'text-slate-400'
                }`
              }
              style={navLinkStyle}
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
