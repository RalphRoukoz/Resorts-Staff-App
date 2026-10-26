import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Buildings,
  CalendarCheck,
  ChartLine,
  CheckCircle,
  Megaphone,
  PauseCircle,
  ShieldWarning,
  Ticket,
  UserCircleCheck,
  Users,
  Warning,
  type Icon,
} from '@phosphor-icons/react'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDate, todayISO } from '../../lib/dates'
import { supabase } from '../../lib/supabase'

interface DeskSummary {
  expectedInvites: number
  expectedVisitors: number
  arrivedInvites: number
  arrivedVisitors: number
}

interface CapacitySummary {
  used: number
  cap: number | null
}

interface ActivitySummary {
  needsReview: number
  actSoon: number
  paused: number
}

interface OverviewData {
  desk: DeskSummary | null
  capacity: CapacitySummary | null
  activity: ActivitySummary | null
}

const NEAR_CAP_RATIO = 0.8

export function OverviewPage() {
  const { t } = useTranslation()
  const { resortId, resort } = useAuth()
  const cabineInvitesEnabled = resort?.cabine_invites_enabled === true
  const [data, setData] = useState<OverviewData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!resortId) return
    let cancelled = false
    const today = todayISO()

    async function load() {
      const [deskResult, capacityResult, patternsResult] = await Promise.all([
        supabase.rpc('resort_today_desk', { p_resort_id: resortId }),
        supabase.rpc('resort_date_capacity', { p_resort: resortId, p_date: today }),
        supabase.rpc('resort_guest_patterns', { p_resort_id: resortId, p_month: `${today.slice(0, 7)}-01` }),
      ])
      if (cancelled) return

      const deskPayload = deskResult.data as {
        error?: string
        expected_invitations?: unknown[]
        checked_in_invitations?: unknown[]
        visitors?: { status: string }[]
      } | null
      const desk: DeskSummary | null =
        deskResult.error || !deskPayload || deskPayload.error
          ? null
          : {
              expectedInvites: deskPayload.expected_invitations?.length ?? 0,
              arrivedInvites: deskPayload.checked_in_invitations?.length ?? 0,
              expectedVisitors: (deskPayload.visitors ?? []).filter((v) => v.status === 'announced').length,
              arrivedVisitors: (deskPayload.visitors ?? []).filter((v) => v.status === 'arrived').length,
            }

      const capPayload = capacityResult.data as { error?: string; used?: number; cap?: number | null } | null
      const capacity: CapacitySummary | null =
        capacityResult.error || !capPayload || capPayload.error
          ? null
          : { used: Number(capPayload.used ?? 0), cap: capPayload.cap == null ? null : Number(capPayload.cap) }

      const patternsPayload = patternsResult.data as {
        error?: string
        units?: { asset_type: string; risk_score: number; invites_suspended_until: string | null }[]
      } | null
      let activity: ActivitySummary | null = null
      if (!patternsResult.error && patternsPayload && !patternsPayload.error) {
        const units = (patternsPayload.units ?? []).filter(
          (u) => cabineInvitesEnabled || u.asset_type !== 'cabine',
        )
        activity = {
          needsReview: units.filter((u) => u.risk_score > 0).length,
          actSoon: units.filter((u) => u.risk_score >= 50).length,
          paused: units.filter((u) => u.invites_suspended_until != null && u.invites_suspended_until >= today).length,
        }
      }

      setData({ desk, capacity, activity })
      setFailed(!desk && !capacity && !activity)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [resortId, cabineInvitesEnabled])

  const hour = new Date().getHours()
  const greetingKey = hour < 12 ? 'overview.greetingMorning' : hour < 18 ? 'overview.greetingAfternoon' : 'overview.greetingEvening'

  if (!data) return <Spinner label={t('common.loading')} />

  const { desk, capacity, activity } = data
  const nearCap = capacity?.cap != null && capacity.cap > 0 && capacity.used / capacity.cap >= NEAR_CAP_RATIO
  const capFull = capacity?.cap != null && capacity.used >= capacity.cap

  const attention: { key: string; tone: 'red' | 'amber' | 'gray'; icon: Icon; text: string; to: string; cta: string }[] = []
  if (activity && activity.needsReview > 0) {
    attention.push({
      key: 'activity',
      tone: activity.actSoon > 0 ? 'red' : 'amber',
      icon: ShieldWarning,
      text:
        activity.actSoon > 0
          ? t('overview.attentionActSoon', { count: activity.needsReview, urgent: activity.actSoon })
          : t('overview.attentionReview', { count: activity.needsReview }),
      to: '/admin/guest-patterns',
      cta: t('overview.ctaReview'),
    })
  }
  if (capacity && nearCap) {
    attention.push({
      key: 'capacity',
      tone: capFull ? 'red' : 'amber',
      icon: Warning,
      text: capFull
        ? t('overview.attentionCapFull', { cap: capacity.cap })
        : t('overview.attentionCapNear', { used: capacity.used, cap: capacity.cap }),
      to: '/admin/today',
      cta: t('overview.ctaToday'),
    })
  }
  if (activity && activity.paused > 0) {
    attention.push({
      key: 'paused',
      tone: 'gray',
      icon: PauseCircle,
      text: t('overview.attentionPaused', { count: activity.paused }),
      to: '/admin/guest-patterns',
      cta: t('overview.ctaView'),
    })
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">
          {t(greetingKey)}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {t('overview.subtitle', { date: formatDate(todayISO()), name: resort?.name ?? '' })}
        </p>
      </div>

      {failed ? (
        <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {t('overview.loadFailed')}
        </p>
      ) : null}

      <section aria-labelledby="overview-today" className="space-y-3">
        <h3 id="overview-today" className="text-sm font-semibold text-[#1A1A1A]">
          {t('overview.todayTitle')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberTile
            icon={Users}
            label={t('overview.expectedToday')}
            value={desk ? desk.expectedInvites + desk.expectedVisitors : null}
            detail={
              desk
                ? t('overview.splitDetail', { invites: desk.expectedInvites, visitors: desk.expectedVisitors })
                : t('overview.unavailable')
            }
            to="/admin/today"
          />
          <NumberTile
            icon={UserCircleCheck}
            label={t('overview.arrivedToday')}
            value={desk ? desk.arrivedInvites + desk.arrivedVisitors : null}
            detail={
              desk
                ? t('overview.splitDetail', { invites: desk.arrivedInvites, visitors: desk.arrivedVisitors })
                : t('overview.unavailable')
            }
            to="/admin/today"
          />
          <NumberTile
            icon={Ticket}
            label={t('overview.invitationsToday')}
            value={capacity ? capacity.used : null}
            detail={
              !capacity
                ? t('overview.unavailable')
                : capacity.cap == null
                  ? t('overview.noDailyLimit')
                  : capFull
                    ? t('overview.dailyLimitFull', { cap: capacity.cap })
                    : t('overview.dailyLimitLeft', { left: capacity.cap - capacity.used, cap: capacity.cap })
            }
            progress={capacity?.cap ? Math.min(capacity.used / capacity.cap, 1) : undefined}
            progressTone={capFull ? 'red' : nearCap ? 'amber' : 'accent'}
            to="/admin/today"
          />
        </div>
      </section>

      <section aria-labelledby="overview-attention" className="space-y-3">
        <h3 id="overview-attention" className="text-sm font-semibold text-[#1A1A1A]">
          {t('overview.attentionTitle')}
        </h3>
        {attention.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-[#ECECEC] bg-white px-5 py-4 shadow-sm">
            <CheckCircle size={24} weight="fill" className="shrink-0 text-emerald-600" aria-hidden />
            <div>
              <p className="text-sm font-medium text-[#1A1A1A]">{t('overview.allClearTitle')}</p>
              <p className="text-sm text-gray-500">{t('overview.allClearBody')}</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[#F3F3F3] overflow-hidden rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
            {attention.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <item.icon
                  size={24}
                  weight="fill"
                  aria-hidden
                  className={`shrink-0 ${
                    item.tone === 'red' ? 'text-red-600' : item.tone === 'amber' ? 'text-amber-500' : 'text-gray-400'
                  }`}
                />
                <p className="min-w-0 flex-1 text-sm text-[#1A1A1A]">{item.text}</p>
                <Link
                  to={item.to}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#ECECEC] px-3 py-2 text-sm font-medium text-[#1A1A1A] transition hover:bg-gray-50"
                >
                  {item.cta}
                  <ArrowRight size={16} aria-hidden className="rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="overview-shortcuts" className="space-y-3">
        <h3 id="overview-shortcuts" className="text-sm font-semibold text-[#1A1A1A]">
          {t('overview.shortcutsTitle')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Shortcut to="/admin/today" icon={CalendarCheck} title={t('nav.today')} body={t('overview.shortcutToday')} />
          <Shortcut to="/admin/units" icon={Buildings} title={t('nav.units')} body={t('overview.shortcutUnits')} />
          <Shortcut
            to="/admin/announcements"
            icon={Megaphone}
            title={t('nav.announcements')}
            body={t('overview.shortcutAnnouncements')}
          />
          <Shortcut to="/admin/analytics" icon={ChartLine} title={t('nav.analytics')} body={t('overview.shortcutAnalytics')} />
        </div>
      </section>
    </div>
  )
}

function NumberTile({
  icon: TileIcon,
  label,
  value,
  detail,
  to,
  progress,
  progressTone = 'accent',
}: {
  icon: Icon
  label: string
  value: number | null
  detail: ReactNode
  to: string
  progress?: number
  progressTone?: 'accent' | 'amber' | 'red'
}) {
  const barColor =
    progressTone === 'red' ? 'bg-red-500' : progressTone === 'amber' ? 'bg-amber-500' : 'bg-[var(--accent)]'
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm transition hover:border-[#DCDCDC]"
    >
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <TileIcon size={18} aria-hidden />
        {label}
      </div>
      <p className="tnum mt-3 text-3xl font-semibold tracking-tight text-[#1A1A1A]">{value ?? '-'}</p>
      {progress != null ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}
      <p className="mt-2 text-sm text-gray-500">{detail}</p>
    </Link>
  )
}

function Shortcut({ to, icon: ShortcutIcon, title, body }: { to: string; icon: Icon; title: string; body: string }) {
  return (
    <Link
      to={to}
      className="flex gap-3 rounded-2xl border border-[#ECECEC] bg-white p-4 shadow-sm transition hover:border-[#DCDCDC]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_9%,white)] text-[var(--accent)]">
        <ShortcutIcon size={20} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[#1A1A1A]">{title}</span>
        <span className="mt-0.5 block text-sm text-gray-500">{body}</span>
      </span>
    </Link>
  )
}
