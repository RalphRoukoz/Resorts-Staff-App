import type { CSSProperties } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { PERMISSIONS } from '../../lib/permissions'
import { DemoBanner } from '../../components/DemoBanner'

const DEFAULT_ACCENT = '#1A1A1A'

const readNavItems = [
  { to: '/admin/units', labelKey: 'nav.units' },
  { to: '/admin/rentals', labelKey: 'nav.rentals' },
  { to: '/admin/today', labelKey: 'nav.today' },
  { to: '/admin/analytics', labelKey: 'nav.analytics' },
  { to: '/admin/announcements', labelKey: 'nav.announcements' },
] as const

const writeNavItems = [
  { to: '/admin/staff', labelKey: 'nav.staff', permission: PERMISSIONS.STAFF_MANAGE },
  { to: '/admin/configuration', labelKey: 'nav.configuration', permission: PERMISSIONS.CONFIG_WRITE },
] as const

export function AdminLayout() {
  const { t } = useTranslation()
  const { resort, canWrite, hasPermission, signOut } = useAuth()

  const filteredWriteNav = writeNavItems.filter((item) => hasPermission(item.permission))
  const navItems = [...readNavItems, ...filteredWriteNav]

  const accent = resort?.primary_color || DEFAULT_ACCENT
  const rootStyle = { '--accent': accent } as CSSProperties

  function navLinkStyle({ isActive }: { isActive: boolean }): CSSProperties {
    return isActive ? { backgroundColor: `${accent}14`, color: accent } : {}
  }

  const desktopNavClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2.5 text-sm font-medium tracking-tight transition duration-200 ${
      isActive ? '' : 'text-gray-500 hover:bg-gray-50 hover:text-[#1A1A1A]'
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
        <p className="mt-0.5 text-xs text-gray-400">
          {canWrite ? t('app.staffDashboard') : t('app.viewOnlyDashboard')}
        </p>
      </div>
    )
  }

  return (
    <div style={rootStyle} className="flex min-h-screen bg-[#FAFAFA] text-[#1A1A1A]">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#ECECEC] bg-white lg:flex">
        <div className="border-b border-[#ECECEC] px-5 py-7">
          <BrandMark />
          <div className="mt-4">
            <LanguageSwitcher />
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={desktopNavClass} style={navLinkStyle}>
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-[#ECECEC] p-3">
          <Button variant="ghost" fullWidth onClick={() => void signOut()}>
            {t('common.signOut')}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[#ECECEC] bg-white px-4 py-3 lg:hidden">
          <BrandMark compact />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="ghost" onClick={() => void signOut()}>
              {t('common.out')}
            </Button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-[#ECECEC] bg-white px-2 py-2 lg:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium tracking-tight transition ${
                  isActive ? '' : 'text-gray-500'
                }`
              }
              style={navLinkStyle}
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-6xl p-4 lg:p-10">
            <DemoBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
