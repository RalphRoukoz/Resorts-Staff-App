import type { CSSProperties } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'

const DEFAULT_ACCENT = '#1A1A1A'

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

  const accent = resort?.primary_color || DEFAULT_ACCENT
  const rootStyle = { '--accent': accent } as CSSProperties

  function openScanner() {
    setView('reception')
    navigate('/scanner')
  }

  function navLinkStyle({ isActive }: { isActive: boolean }): CSSProperties {
    return isActive ? { backgroundColor: `${accent}14`, color: accent } : {}
  }

  const desktopNavClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-xl px-3 py-2.5 text-sm font-medium transition ${
      isActive ? '' : 'text-gray-500 hover:bg-gray-100 hover:text-[#1A1A1A]'
    }`

  function BrandMark({ compact = false }: { compact?: boolean }) {
    if (resort?.logo_url) {
      return (
        <img
          src={resort.logo_url}
          alt={resort?.name ?? 'Resort'}
          className={compact ? 'h-8 w-auto max-w-[120px] object-contain' : 'h-10 w-auto max-w-[180px] object-contain'}
        />
      )
    }
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: accent }}>
          {resort?.name ?? 'Resort'}
        </p>
        <p className="mt-0.5 text-xs text-gray-400">Staff dashboard</p>
      </div>
    )
  }

  return (
    <div style={rootStyle} className="flex min-h-screen bg-[#FAFAFA] text-[#1A1A1A]">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#ECECEC] bg-white lg:flex">
        <div className="border-b border-[#ECECEC] px-5 py-6">
          <BrandMark />
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={desktopNavClass} style={navLinkStyle}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-2 border-t border-[#ECECEC] p-3">
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
        <header className="flex items-center justify-between border-b border-[#ECECEC] bg-white px-4 py-3 lg:hidden">
          <BrandMark compact />
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

        <nav className="flex gap-1 overflow-x-auto border-b border-[#ECECEC] bg-white px-2 py-2 lg:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium ${
                  isActive ? '' : 'text-gray-500'
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
