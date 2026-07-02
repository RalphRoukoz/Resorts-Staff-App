import { useCallback, useEffect, useState, type ReactNode } from 'react'
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
import { UnitSearchSelect } from '../../components/UnitSearchSelect'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { monthLabel } from '../../lib/dates'
import { supabase } from '../../lib/supabase'

const DEFAULT_BRAND = '#1A1A1A'
const WEEKEND_COLOR = '#f59e0b'

interface AnalyticsPayload {
  monthly: { month: string; visits: number }[]
  daily: { day: number; visits: number }[]
  by_unit: { label: string; visits: number }[]
  weekday: number
  weekend: number
}

export function AnalyticsPage() {
  const { resortId, resort } = useAuth()
  const brand = resort?.primary_color || DEFAULT_BRAND

  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [unitFilter, setUnitFilter] = useState<string>('all')
  const [unitFilterLabel, setUnitFilterLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const { data: rpcData, error: rpcError } = await supabase.rpc('resort_visit_analytics', {
      p_resort_id: resortId,
      p_asset_id: unitFilter === 'all' ? null : unitFilter,
    })

    if (rpcError) {
      setError(rpcError.message)
      setData(null)
    } else {
      setData(rpcData as AnalyticsPayload)
    }
    setLoading(false)
  }, [resortId, unitFilter])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (loading) return <Spinner label="Loading analytics…" />

  const monthlyData = (data?.monthly ?? []).map((row) => ({
    month: monthLabel(row.month),
    visits: row.visits,
  }))

  const dailyData = (data?.daily ?? []).map((row) => ({
    day: String(row.day),
    visits: row.visits,
  }))

  const byUnitData = data?.by_unit ?? []

  const splitData = [
    { name: 'Weekday', value: data?.weekday ?? 0 },
    { name: 'Weekend', value: data?.weekend ?? 0 },
  ]

  const hasVisits =
    monthlyData.length > 0 ||
    dailyData.length > 0 ||
    byUnitData.length > 0 ||
    (data?.weekday ?? 0) + (data?.weekend ?? 0) > 0

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
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Analytics</h2>
          <p className="mt-1 text-sm text-gray-500">Validated visits across this resort.</p>
        </div>
        <div className="min-w-[220px]">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Unit filter</span>
          {unitFilter === 'all' ? (
            <div className="flex gap-2">
              {resortId ? (
                <div className="min-w-0 flex-1">
                  <UnitSearchSelect
                    resortId={resortId}
                    value=""
                    onChange={(id, opt) => {
                      setUnitFilter(id)
                      setUnitFilterLabel(opt ? `${opt.label} (${opt.asset_type})` : '')
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-[#ECECEC] bg-white px-3 py-2 text-sm">
              <span className="flex-1 truncate">{unitFilterLabel || 'Selected unit'}</span>
              <Button variant="ghost" className="!px-2 !py-1" onClick={() => {
                setUnitFilter('all')
                setUnitFilterLabel('')
              }}>
                All units
              </Button>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {!hasVisits ? (
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
                <Line type="monotone" dataKey="visits" stroke={brand} strokeWidth={2} dot={{ r: 3 }} />
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
                <Pie data={splitData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
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
