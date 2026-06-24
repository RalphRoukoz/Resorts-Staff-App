import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { todayISO } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { Asset, DayType } from '../../types/database'

const DEFAULT_BRAND = '#1A1A1A'
const WEEKEND_COLOR = '#f59e0b'

interface VisitRow {
  validated_at: string
  day_type: DayType
  asset_id: string
  label: string
}

/** YYYY-MM-DD for a timestamp, in Asia/Beirut. */
function beirutYMD(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Beirut',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function monthLabel(ym: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Beirut',
  }).format(new Date(`${ym}-01T12:00:00Z`))
}

export function AnalyticsPage() {
  const { resortId, resort } = useAuth()
  const brand = resort?.primary_color || DEFAULT_BRAND

  const [rows, setRows] = useState<VisitRow[]>([])
  const [units, setUnits] = useState<Asset[]>([])
  const [unitFilter, setUnitFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const [visitsResult, unitsResult] = await Promise.all([
      supabase
        .from('invitations')
        .select('validated_at, day_type, asset_id, assets!inner(label, resort_id)')
        .eq('assets.resort_id', resortId)
        .eq('status', 'validated')
        .not('validated_at', 'is', null),
      supabase.from('assets').select('*').eq('resort_id', resortId).order('label'),
    ])

    if (visitsResult.error) {
      setError(visitsResult.error.message)
      setLoading(false)
      return
    }

    const mapped: VisitRow[] = (visitsResult.data ?? []).map((row: Record<string, unknown>) => {
      const assetField = row.assets as { label?: string } | { label?: string }[] | null
      const asset = Array.isArray(assetField) ? assetField[0] : assetField
      return {
        validated_at: row.validated_at as string,
        day_type: row.day_type as DayType,
        asset_id: row.asset_id as string,
        label: asset?.label ?? 'Unknown',
      }
    })

    setRows(mapped)
    if (unitsResult.data) setUnits(unitsResult.data as Asset[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filtered = useMemo(
    () => (unitFilter === 'all' ? rows : rows.filter((r) => r.asset_id === unitFilter)),
    [rows, unitFilter],
  )

  const monthlyData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of filtered) {
      const ym = beirutYMD(r.validated_at).slice(0, 7)
      counts.set(ym, (counts.get(ym) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, visits]) => ({ month: monthLabel(ym), visits }))
  }, [filtered])

  const dailyData = useMemo(() => {
    const currentMonth = todayISO().slice(0, 7)
    const counts = new Map<number, number>()
    for (const r of filtered) {
      const ymd = beirutYMD(r.validated_at)
      if (ymd.slice(0, 7) !== currentMonth) continue
      const day = Number(ymd.slice(8, 10))
      counts.set(day, (counts.get(day) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a - b)
      .map(([day, visits]) => ({ day: String(day), visits }))
  }, [filtered])

  const byUnitData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of filtered) {
      counts.set(r.label, (counts.get(r.label) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([label, visits]) => ({ label, visits }))
  }, [filtered])

  const splitData = useMemo(() => {
    let weekday = 0
    let weekend = 0
    for (const r of filtered) {
      if (r.day_type === 'weekend') weekend += 1
      else weekday += 1
    }
    return [
      { name: 'Weekday', value: weekday },
      { name: 'Weekend', value: weekend },
    ]
  }, [filtered])

  if (loading) return <Spinner label="Loading analytics…" />

  const axisProps = { stroke: '#9ca3af', fontSize: 12 }
  const tooltipStyle = {
    backgroundColor: '#ffffff',
    border: '1px solid #ECECEC',
    borderRadius: 12,
    color: '#1A1A1A',
    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-[#1A1A1A]">Analytics</h2>
          <p className="mt-1 text-sm text-gray-500">Validated visits across this resort.</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Unit</span>
          <select
            className="rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
          >
            <option value="all">All units</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label} ({u.asset_type})
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-[#ECECEC] bg-white px-4 py-12 text-center text-gray-400 shadow-sm">
          No validated visits yet.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Visits per month">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#00000008' }} />
                <Bar dataKey="visits" fill={brand} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Visits per day (this month)">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="visits"
                  stroke={brand}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Visits by unit">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byUnitData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" allowDecimals={false} {...axisProps} />
                <YAxis type="category" dataKey="label" width={100} {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#00000008' }} />
                <Bar dataKey="visits" fill={brand} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Weekday vs weekend">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={splitData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label
                >
                  <Cell fill={brand} />
                  <Cell fill={WEEKEND_COLOR} />
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
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
