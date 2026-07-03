import type { CSSProperties } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'

const ACCENT = '#0E7C7B'

const navItems = [
  { to: '/superadmin/overview', labelKey: 'nav.overview' },
  { to: '/superadmin/resorts', labelKey: 'nav.resorts' },
  { to: '/superadmin/admins', labelKey: 'nav.resortAdmins' },
] as const

export function SuperAdminLayout() {
  const { t } = useTranslation()
  const { signOut } = useAuth()

  const rootStyle = { '--accent': ACCENT } as CSSProperties

  function navLinkStyle({ isActive }: { isActive: boolean }): CSSProperties {
    return isActive ? { backgroundColor: `${ACCENT}14`, color: ACCENT } : {}
  }

  return (
    <div style={rootStyle} className="flex min-h-screen bg-[#FAFAFA] text-[#1A1A1A]">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#ECECEC] bg-white lg:flex">
        <div className="border-b border-[#ECECEC] px-5 py-6">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: ACCENT }}>
            {t('app.superAdmin')}
          </p>
          <h1 className="mt-1 text-lg font-semibold text-[#1A1A1A]">{t('app.platformConsole')}</h1>
          <div className="mt-4">
            <LanguageSwitcher />
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={navLinkStyle}
              className={({ isActive }) =>
                `block rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? '' : 'text-gray-500 hover:bg-gray-100 hover:text-[#1A1A1A]'
                }`
              }
            >
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
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: ACCENT }}>
              {t('app.superAdmin')}
            </p>
            <p className="font-medium text-[#1A1A1A]">{t('app.platformConsole')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="ghost" onClick={() => void signOut()}>
              {t('common.signOut')}
            </Button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-[#ECECEC] bg-white px-2 py-2 lg:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={navLinkStyle}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium ${isActive ? '' : 'text-gray-500'}`
              }
            >
              {t(item.labelKey)}
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
