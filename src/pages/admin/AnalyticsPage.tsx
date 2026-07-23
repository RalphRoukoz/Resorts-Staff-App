import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDate, todayISO } from '../../lib/dates'
import { displayPhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import { isDemoMode, demoAnalytics } from '../../demo/demoData'

const DEFAULT_BRAND = '#1A1A1A'
const WEEKEND_COLOR = '#956400'
const GUEST_PAGE_SIZE = 100

type AnalyticsLane = 'invitations' | 'visitors'

interface GuestRow {
  name: string
  unit: string
  visits: number
  last_visit: string
}

interface AnalyticsPayload {
  totals: { visits: number; unique_guests: number }
  daily: { date?: string; day?: number; visits: number }[]
  by_unit: { label: string; visits: number }[]
  guests: GuestRow[]
  guests_total?: number
  weekday: number
  weekend: number
  date_from: string
  date_to: string
  guest_limit?: number
  guest_offset?: number
}

type VisitorAnalyticsRow = {
  id: string
  visitor_name: string
  visitor_phone: string | null
  visit_date: string
  status: string
  arrived_at: string | null
  notes: string | null
  assets: { label: string } | null
}

function monthStartISO(): string {
  const today = todayISO()
  return `${today.slice(0, 7)}-01`
}

function formatChartDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function aggregateVisitors(rows: VisitorAnalyticsRow[]) {
  const arrived = rows.filter((r) => r.status === 'arrived')
  const announced = rows.filter((r) => r.status === 'announced')
  const other = rows.filter((r) => r.status !== 'arrived' && r.status !== 'announced')

  const byDayMap = new Map<string, number>()
  for (const row of arrived) {
    byDayMap.set(row.visit_date, (byDayMap.get(row.visit_date) ?? 0) + 1)
  }
  const daily = [...byDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, visits]) => ({ date, label: formatChartDate(date), visits }))

  const byUnitMap = new Map<string, number>()
  for (const row of arrived) {
    const label = row.assets?.label ?? '—'
    byUnitMap.set(label, (byUnitMap.get(label) ?? 0) + 1)
  }
  const byUnit = [...byUnitMap.entries()]
    .map(([label, visits]) => ({ label, visits }))
    .sort((a, b) => b.visits - a.visits)

  const uniqueNames = new Set(arrived.map((r) => r.visitor_name.trim().toLowerCase()).filter(Boolean))

  return {
    totals: {
      arrived: arrived.length,
      announced: announced.length,
      other: other.length,
      unique: uniqueNames.size,
    },
    daily,
    byUnit,
    recentArrivals: [...arrived]
      .sort((a, b) => (b.arrived_at ?? b.visit_date).localeCompare(a.arrived_at ?? a.visit_date))
      .slice(0, 50),
  }
}

export function AnalyticsPage() {
  const { t } = useTranslation()
  const { resortId, resort } = useAuth()
  const brand = resort?.primary_color || DEFAULT_BRAND

  const [lane, setLane] = useState<AnalyticsLane>('invitations')
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [visitorRows, setVisitorRows] = useState<VisitorAnalyticsRow[]>([])
  const [draftChalet, setDraftChalet] = useState('')
  const [draftGuest, setDraftGuest] = useState('')
  const [draftDateFrom, setDraftDateFrom] = useState(monthStartISO())
  const [draftDateTo, setDraftDateTo] = useState(todayISO())

  const [appliedChalet, setAppliedChalet] = useState('')
  const [appliedGuest, setAppliedGuest] = useState('')
  const [appliedDateFrom, setAppliedDateFrom] = useState(monthStartISO())
  const [appliedDateTo, setAppliedDateTo] = useState(todayISO())
  const [guestOffset, setGuestOffset] = useState(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadInvitationAnalytics = useCallback(async () => {
    if (!resortId) return
    if (isDemoMode()) {
      setData(demoAnalytics)
      return
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('resort_visit_analytics_v2', {
      p_resort_id: resortId,
      p_asset_id: null,
      p_date_from: appliedDateFrom,
      p_date_to: appliedDateTo,
      p_guest_name: appliedGuest || null,
      p_guest_limit: GUEST_PAGE_SIZE,
      p_guest_offset: guestOffset,
      p_unit_label: appliedChalet || null,
    })

    if (rpcError) {
      setError(rpcError.message)
      setData(null)
      return
    }

    const payload = rpcData as AnalyticsPayload & { error?: string }
    if (payload?.error) {
      setError(
        payload.error === 'NOT_AUTHORIZED' ? t('analytics.notAuthorized') : payload.error,
      )
      setData(null)
      return
    }
    setData(rpcData as AnalyticsPayload)
  }, [resortId, appliedChalet, appliedGuest, appliedDateFrom, appliedDateTo, guestOffset, t])

  const loadVisitorAnalytics = useCallback(async () => {
    if (!resortId) return
    if (isDemoMode()) {
      setVisitorRows([])
      return
    }

    let query = supabase
      .from('visitor_announcements')
      .select('id, visitor_name, visitor_phone, visit_date, status, arrived_at, notes, assets(label)')
      .eq('resort_id', resortId)
      .gte('visit_date', appliedDateFrom)
      .lte('visit_date', appliedDateTo)
      .order('visit_date', { ascending: false })
      .limit(2000)

    if (appliedChalet.trim()) {
      // Filter after fetch by unit label — PostgREST nested filter is awkward here.
    }

    const { data: rows, error: fetchError } = await query
    if (fetchError) {
      if (!/visitor_announcements|schema cache/i.test(fetchError.message)) {
        setError(fetchError.message)
      }
      setVisitorRows([])
      return
    }

    let next = (rows ?? []) as unknown as VisitorAnalyticsRow[]
    const unitQ = appliedChalet.trim().toLowerCase()
    const guestQ = appliedGuest.trim().toLowerCase()
    if (unitQ) {
      next = next.filter((r) => (r.assets?.label ?? '').toLowerCase().includes(unitQ))
    }
    if (guestQ) {
      next = next.filter((r) => r.visitor_name.toLowerCase().includes(guestQ))
    }
    setVisitorRows(next)
  }, [resortId, appliedDateFrom, appliedDateTo, appliedChalet, appliedGuest])

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)
    if (lane === 'invitations') await loadInvitationAnalytics()
    else await loadVisitorAnalytics()
    setLoading(false)
  }, [resortId, lane, loadInvitationAnalytics, loadVisitorAnalytics])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function applyFilters() {
    setAppliedChalet(draftChalet.trim())
    setAppliedGuest(draftGuest.trim())
    setAppliedDateFrom(draftDateFrom)
    setAppliedDateTo(draftDateTo)
    setGuestOffset(0)
  }

  function resetFilters() {
    const from = monthStartISO()
    const to = todayISO()
    setDraftChalet('')
    setDraftGuest('')
    setDraftDateFrom(from)
    setDraftDateTo(to)
    setAppliedChalet('')
    setAppliedGuest('')
    setAppliedDateFrom(from)
    setAppliedDateTo(to)
    setGuestOffset(0)
  }

  const visitorStats = useMemo(() => aggregateVisitors(visitorRows), [visitorRows])

  if (loading && !data && visitorRows.length === 0) {
    return <Spinner label={t('analytics.loading')} />
  }

  const dailyData = (data?.daily ?? []).map((row) => ({
    label: row.date ? formatChartDate(row.date) : String(row.day ?? ''),
    visits: row.visits,
  }))
  const byUnitData = data?.by_unit ?? []
  const guests = data?.guests ?? []
  const hasInviteVisits = (data?.totals.visits ?? 0) > 0
  const guestsTotal = data?.guests_total ?? guests.length
  const guestPageEnd = Math.min(guestOffset + GUEST_PAGE_SIZE, guestsTotal)
  const hasGuestPagination = guestsTotal > GUEST_PAGE_SIZE
  const hasVisitorData = visitorRows.length > 0

  const axisProps = { stroke: '#9ca3af', fontSize: 12 }
  const tooltipStyle = {
    backgroundColor: '#ffffff',
    border: '1px solid #ECECEC',
    borderRadius: 12,
    color: '#1A1A1A',
    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('analytics.title')}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {lane === 'invitations' ? t('analytics.subtitleInvites') : t('analytics.subtitleVisitors')}
          </p>
        </div>
        <div role="tablist" aria-label={t('analytics.laneLabel')} className="inline-flex rounded-xl bg-gray-100 p-1">
          {(
            [
              { value: 'invitations' as const, label: t('analytics.laneInvitations') },
              { value: 'visitors' as const, label: t('analytics.laneVisitors') },
            ] as const
          ).map((opt) => {
            const active = lane === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setLane(opt.value)}
                className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition ${
                  active ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-gray-500 hover:text-[#1A1A1A]'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[#ECECEC] bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Input
            label={t('analytics.chaletSearch')}
            value={draftChalet}
            onChange={(e) => setDraftChalet(e.target.value)}
            placeholder={t('analytics.chaletSearchPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters()
            }}
          />
          <Input
            label={lane === 'invitations' ? t('analytics.guestSearch') : t('analytics.visitorSearch')}
            value={draftGuest}
            onChange={(e) => setDraftGuest(e.target.value)}
            placeholder={
              lane === 'invitations'
                ? t('analytics.guestSearchPlaceholder')
                : t('analytics.visitorSearchPlaceholder')
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters()
            }}
          />
          <Input
            label={t('analytics.dateFrom')}
            type="date"
            value={draftDateFrom}
            onChange={(e) => setDraftDateFrom(e.target.value)}
          />
          <Input
            label={t('analytics.dateTo')}
            type="date"
            value={draftDateTo}
            onChange={(e) => setDraftDateTo(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={applyFilters}>{t('analytics.apply')}</Button>
          <Button variant="secondary" onClick={resetFilters}>
            {t('analytics.reset')}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="relative min-h-[20rem]">
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/70 backdrop-blur-[2px]">
            <Spinner label={t('analytics.loading')} />
          </div>
        ) : null}

        <div className={loading ? 'pointer-events-none select-none opacity-40' : undefined}>
      {lane === 'invitations' ? (
        !hasInviteVisits && !loading ? (
          <EmptyCard message={t('analytics.emptyInvites')} />
        ) : data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label={t('analytics.totalVisits')} value={data.totals.visits} accent={brand} />
              <KpiCard
                label={t('analytics.uniqueGuests')}
                value={data.totals.unique_guests}
                accent={brand}
              />
              <KpiCard label={t('analytics.weekday')} value={data.weekday} accent={brand} />
              <KpiCard label={t('analytics.weekend')} value={data.weekend} accent={WEEKEND_COLOR} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title={t('analytics.visitsOverTime')}>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="visits" stroke={brand} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title={t('analytics.visitsByUnit')}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byUnitData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" allowDecimals={false} {...axisProps} />
                    <YAxis type="category" dataKey="label" width={100} {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#00000008' }} />
                    <Bar dataKey="visits" fill={brand} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {guests.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ECECEC] px-5 py-4">
                  <h3 className="text-sm font-medium text-gray-700">{t('analytics.guestTable')}</h3>
                  {hasGuestPagination ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>
                        {guestOffset + 1}–{guestPageEnd} / {guestsTotal}
                      </span>
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1"
                        disabled={guestOffset === 0}
                        onClick={() => setGuestOffset((o) => Math.max(0, o - GUEST_PAGE_SIZE))}
                      >
                        {t('analytics.previous')}
                      </Button>
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1"
                        disabled={guestOffset + GUEST_PAGE_SIZE >= guestsTotal}
                        onClick={() => setGuestOffset((o) => o + GUEST_PAGE_SIZE)}
                      >
                        {t('analytics.next')}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#ECECEC] bg-[#FAFAFA] text-start text-gray-500">
                      <th className="px-5 py-3 font-medium">{t('analytics.guestCol')}</th>
                      <th className="px-5 py-3 font-medium">{t('analytics.unitCol')}</th>
                      <th className="px-5 py-3 font-medium tnum">{t('analytics.visitsCol')}</th>
                      <th className="px-5 py-3 font-medium">{t('analytics.lastVisitCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g) => (
                      <tr key={`${g.name}-${g.unit}`} className="border-b border-[#ECECEC] last:border-0">
                        <td className="px-5 py-3">{g.name}</td>
                        <td className="px-5 py-3 text-gray-600">{g.unit}</td>
                        <td className="px-5 py-3 tnum font-medium">{g.visits}</td>
                        <td className="px-5 py-3 text-gray-600">{formatDate(g.last_visit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null
      ) : !hasVisitorData && !loading ? (
        <EmptyCard message={t('analytics.emptyVisitors')} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={t('analytics.visitorsArrived')}
              value={visitorStats.totals.arrived}
              accent={brand}
            />
            <KpiCard
              label={t('analytics.visitorsUnique')}
              value={visitorStats.totals.unique}
              accent={brand}
            />
            <KpiCard
              label={t('analytics.visitorsPending')}
              value={visitorStats.totals.announced}
              accent={brand}
            />
            <KpiCard
              label={t('analytics.visitorsOther')}
              value={visitorStats.totals.other}
              accent="#64748b"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title={t('analytics.arrivalsOverTime')}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={visitorStats.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="visits" stroke={brand} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t('analytics.arrivalsByUnit')}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={visitorStats.byUnit} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" allowDecimals={false} {...axisProps} />
                  <YAxis type="category" dataKey="label" width={100} {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#00000008' }} />
                  <Bar dataKey="visits" fill={brand} radius={[0, 4, 4, 0]}>
                    {visitorStats.byUnit.map((_, i) => (
                      <Cell key={i} fill={brand} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {visitorStats.recentArrivals.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
              <div className="border-b border-[#ECECEC] px-5 py-4">
                <h3 className="text-sm font-medium text-gray-700">{t('analytics.recentArrivals')}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#ECECEC] bg-[#FAFAFA] text-start text-gray-500">
                    <th className="px-5 py-3 font-medium">{t('analytics.guestCol')}</th>
                    <th className="px-5 py-3 font-medium">{t('analytics.phoneCol')}</th>
                    <th className="px-5 py-3 font-medium">{t('analytics.unitCol')}</th>
                    <th className="px-5 py-3 font-medium">{t('analytics.visitDateCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visitorStats.recentArrivals.map((row) => (
                    <tr key={row.id} className="border-b border-[#ECECEC] last:border-0">
                      <td className="px-5 py-3 font-medium">{row.visitor_name}</td>
                      <td className="px-5 py-3 text-gray-600">{displayPhone(row.visitor_phone)}</td>
                      <td className="px-5 py-3 text-gray-600">{row.assets?.label ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-600">{formatDate(row.visit_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
        </div>
      </div>
    </div>
  )
}

function EmptyCard({ message }: { message: string }) {
  return (
    <p className="rounded-2xl border border-[#ECECEC] bg-white px-4 py-12 text-center text-gray-400 shadow-sm">
      {message}
    </p>
  )
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight" style={{ color: accent }}>
        {value}
      </p>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-gray-700">{title}</h3>
      {children}
    </div>
  )
}
