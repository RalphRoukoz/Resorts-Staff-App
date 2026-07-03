import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
import { supabase } from '../../lib/supabase'
import { isDemoMode, demoAnalytics } from '../../demo/demoData'

const DEFAULT_BRAND = '#1A1A1A'
const WEEKEND_COLOR = '#956400'

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

const GUEST_PAGE_SIZE = 100

function monthStartISO(): string {
  const today = todayISO()
  return `${today.slice(0, 7)}-01`
}

function formatChartDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function AnalyticsPage() {
  const { t } = useTranslation()
  const { resortId, resort } = useAuth()
  const brand = resort?.primary_color || DEFAULT_BRAND

  const [data, setData] = useState<AnalyticsPayload | null>(null)
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

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    if (isDemoMode()) {
      setData(demoAnalytics)
      setLoading(false)
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
    } else {
      const payload = rpcData as AnalyticsPayload & { error?: string }
      if (payload?.error) {
        setError(
          payload.error === 'NOT_AUTHORIZED'
            ? t('analytics.notAuthorized')
            : payload.error,
        )
        setData(null)
      } else {
        setData(rpcData as AnalyticsPayload)
      }
    }
    setLoading(false)
  }, [resortId, appliedChalet, appliedGuest, appliedDateFrom, appliedDateTo, guestOffset, t])

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

  if (loading && !data) return <Spinner label={t('analytics.loading')} />

  const dailyData = (data?.daily ?? []).map((row) => ({
    label: row.date ? formatChartDate(row.date) : String(row.day ?? ''),
    visits: row.visits,
  }))
  const byUnitData = data?.by_unit ?? []
  const guests = data?.guests ?? []
  const hasVisits = (data?.totals.visits ?? 0) > 0
  const guestsTotal = data?.guests_total ?? guests.length
  const guestPageEnd = Math.min(guestOffset + GUEST_PAGE_SIZE, guestsTotal)
  const hasGuestPagination = guestsTotal > GUEST_PAGE_SIZE

  const weekdayWeekendData = [
    { name: t('analytics.weekday'), visits: data?.weekday ?? 0 },
    { name: t('analytics.weekend'), visits: data?.weekend ?? 0 },
  ]

  const topUnitsData = byUnitData.slice(0, 8)
  const pieColors = [brand, '#1F6C9F', '#956400', '#0E7C7B', '#863bff', '#47bfff', '#64748b', '#94a3b8']

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
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('analytics.title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('analytics.subtitle')}</p>
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
            label={t('analytics.guestSearch')}
            value={draftGuest}
            onChange={(e) => setDraftGuest(e.target.value)}
            placeholder={t('analytics.guestSearchPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters()
            }}
          />
          <Input label={t('analytics.dateFrom')} type="date" value={draftDateFrom} onChange={(e) => setDraftDateFrom(e.target.value)} />
          <Input label={t('analytics.dateTo')} type="date" value={draftDateTo} onChange={(e) => setDraftDateTo(e.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={applyFilters}>{t('analytics.apply')}</Button>
          <Button variant="secondary" onClick={resetFilters}>
            {t('analytics.reset')}
          </Button>
        </div>
      </div>

      {loading ? <Spinner label={t('analytics.loading')} /> : null}

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {!hasVisits && !loading ? (
        <p className="rounded-2xl border border-[#ECECEC] bg-white px-4 py-12 text-center text-gray-400 shadow-sm">
          {t('analytics.empty')}
        </p>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t('analytics.totalVisits')} value={data.totals.visits} accent={brand} />
            <KpiCard label={t('analytics.uniqueGuests')} value={data.totals.unique_guests} accent={brand} />
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

            <ChartCard title={t('analytics.weekdayWeekend')}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={weekdayWeekendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="visits" radius={[4, 4, 0, 0]}>
                    <Cell fill={brand} />
                    <Cell fill={WEEKEND_COLOR} />
                  </Bar>
                </BarChart>
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

            {topUnitsData.length > 1 ? (
              <ChartCard title={t('analytics.unitShare')}>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={topUnitsData} dataKey="visits" nameKey="label" cx="50%" cy="50%" outerRadius={80}>
                      {topUnitsData.map((_, i) => (
                        <Cell key={i} fill={pieColors[i % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            ) : null}
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
      ) : null}
    </div>
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
