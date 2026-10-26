import { useEffect, useState, type CSSProperties } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Buildings,
  CalendarCheck,
  CalendarStar,
  ChartLine,
  ChatCircleText,
  GearSix,
  House,
  Key,
  List,
  Megaphone,
  ShieldWarning,
  SignOut,
  Storefront,
  Ticket,
  UsersThree,
  X,
  type Icon,
} from '@phosphor-icons/react'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useAuth } from '../../context/AuthContext'
import { PERMISSIONS } from '../../lib/permissions'
import { DemoBanner } from '../../components/DemoBanner'

const DEFAULT_ACCENT = '#1A1A1A'

interface NavItem {
  to: string
  labelKey: string
  icon: Icon
}

interface NavGroup {
  labelKey: string | null
  items: NavItem[]
}

export function AdminLayout() {
  const { t } = useTranslation()
  const { resort, canWrite, hasPermission, staffUsername, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  const marketplaceEnabled = resort?.marketplace_listings_enabled !== false
  const canManageEvents =
    resort?.events_enabled === true &&
    (hasPermission(PERMISSIONS.EVENTS_WRITE) || hasPermission(PERMISSIONS.ANNOUNCEMENTS_WRITE))

  const groups: NavGroup[] = [
    {
      labelKey: null,
      items: [{ to: '/admin/overview', labelKey: 'nav.overview', icon: House }],
    },
    {
      labelKey: 'nav.groupDaily',
      items: [
        { to: '/admin/today', labelKey: 'nav.today', icon: CalendarCheck },
        { to: '/admin/units', labelKey: 'nav.units', icon: Buildings },
        { to: '/admin/rentals', labelKey: 'nav.rentals', icon: Key },
        ...(hasPermission(PERMISSIONS.INVITATIONS_QUOTA)
          ? [{ to: '/admin/invite-quotas', labelKey: 'nav.inviteQuotas', icon: Ticket }]
          : []),
      ],
    },
    {
      labelKey: 'nav.groupCommunication',
      items: [
        { to: '/admin/announcements', labelKey: 'nav.announcements', icon: Megaphone },
        ...(hasPermission(PERMISSIONS.ANNOUNCEMENTS_WRITE)
          ? [{ to: '/admin/messages', labelKey: 'nav.messages', icon: ChatCircleText }]
          : []),
        ...(canManageEvents ? [{ to: '/admin/events', labelKey: 'nav.events', icon: CalendarStar }] : []),
        ...(marketplaceEnabled ? [{ to: '/admin/listings', labelKey: 'nav.listings', icon: Storefront }] : []),
      ],
    },
    {
      labelKey: 'nav.groupInsights',
      items: [
        { to: '/admin/analytics', labelKey: 'nav.analytics', icon: ChartLine },
        { to: '/admin/guest-patterns', labelKey: 'nav.guestPatterns', icon: ShieldWarning },
      ],
    },
    {
      labelKey: 'nav.groupSettings',
      items: [
        ...(hasPermission(PERMISSIONS.DASHBOARD_WRITE)
          ? [{ to: '/admin/configuration', labelKey: 'nav.configuration', icon: GearSix }]
          : []),
        ...(hasPermission(PERMISSIONS.STAFF_MANAGE)
          ? [{ to: '/admin/staff', labelKey: 'nav.staff', icon: UsersThree }]
          : []),
      ],
    },
  ].filter((group) => group.items.length > 0)

  const accent = resort?.primary_color || DEFAULT_ACCENT
  const rootStyle = { '--accent': accent } as CSSProperties

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [menuOpen])

  function renderBrandMark(compact = false) {
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

  function renderNavGroups() {
    return (
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.labelKey ?? 'top'}>
            {group.labelKey ? (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {t(group.labelKey)}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium tracking-tight transition duration-200 ${
                        isActive
                          ? 'bg-[color-mix(in_srgb,var(--accent)_9%,white)] text-[var(--accent)]'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-[#1A1A1A]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon size={20} weight={isActive ? 'fill' : 'regular'} aria-hidden />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    )
  }

  function renderAccountFooter() {
    return (
      <div className="border-t border-[#ECECEC] p-3">
        {staffUsername ? (
          <p className="mb-2 truncate px-3 text-xs text-gray-500" title={staffUsername}>
            {t('app.signedInAs', { username: staffUsername })}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-[#1A1A1A]"
        >
          <SignOut size={20} aria-hidden />
          {t('common.signOut')}
        </button>
      </div>
    )
  }

  return (
    <div style={rootStyle} className="flex min-h-screen bg-[#FAFAFA] text-[#1A1A1A]">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-[#ECECEC] bg-white lg:flex">
        <div className="border-b border-[#ECECEC] px-5 py-6">
          {renderBrandMark()}
          <div className="mt-4">
            <LanguageSwitcher />
          </div>
        </div>
        <nav aria-label={t('nav.mainMenu')} className="flex-1 overflow-y-auto p-3">
          {renderNavGroups()}
        </nav>
        {renderAccountFooter()}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#ECECEC] bg-white px-4 py-3 lg:hidden">
          {renderBrandMark(true)}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls="admin-mobile-menu"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#ECECEC] px-3 text-sm font-medium text-[#1A1A1A]"
          >
            <List size={20} aria-hidden />
            {t('nav.menu')}
          </button>
        </header>

        {menuOpen ? (
          <div
            id="admin-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.mainMenu')}
            className="fixed inset-0 z-40 flex flex-col bg-white lg:hidden"
          >
            <div className="flex items-center justify-between border-b border-[#ECECEC] px-4 py-3">
              {renderBrandMark(true)}
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t('common.close')}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#ECECEC]"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">{renderNavGroups()}</nav>
            <div className="border-t border-[#ECECEC] px-6 pt-3">
              <LanguageSwitcher />
            </div>
            {renderAccountFooter()}
          </div>
        ) : null}

        <main className="flex-1">
          <div className="mx-auto w-full max-w-6xl p-4 lg:p-10">
            <DemoBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
