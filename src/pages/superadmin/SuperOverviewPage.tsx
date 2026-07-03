import { useEffect, useState } from 'react'
import { Spinner } from '../../components/ui/Spinner'
import { todayISO } from '../../lib/dates'
import { supabase } from '../../lib/supabase'

interface PlatformStats {
  resort_count: number
  chalet_count: number
  invitations_this_month: number
  check_ins_this_month: number
}

interface PlatformStatsView {
  resortCount: number
  chaletCount: number
  invitationsThisMonth: number
  checkInsThisMonth: number
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#ECECEC] bg-white px-6 py-6 shadow-sm transition duration-200 hover:shadow-md">
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className="tnum mt-2 text-4xl font-semibold tracking-tight text-[#1A1A1A]">{value}</p>
    </div>
  )
}

export function SuperOverviewPage() {
  const [stats, setStats] = useState<PlatformStatsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      const today = todayISO()
      const monthStart = `${today.slice(0, 7)}-01`

      const { data, error: rpcError } = await supabase.rpc('platform_overview_stats', {
        p_month_start: monthStart,
      })

      if (rpcError) {
        setError(rpcError.message)
        setLoading(false)
        return
      }

      const row = data as PlatformStats & { error?: string; month_start?: string }
      if (row.error) {
        setError(row.error === 'NOT_AUTHORIZED' ? 'You do not have permission to view overview.' : row.error)
        setLoading(false)
        return
      }

      setStats({
        resortCount: row.resort_count ?? 0,
        chaletCount: row.chalet_count ?? 0,
        invitationsThisMonth: row.invitations_this_month ?? 0,
        checkInsThisMonth: row.check_ins_this_month ?? 0,
      })
      setLoading(false)
    }

    void load()
  }, [])

  if (loading) return <Spinner label="Loading overview…" />

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Overview</h2>
        <p className="mt-1 text-sm text-gray-500">Platform-wide totals.</p>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Resorts" value={stats.resortCount} />
          <StatCard label="Chalets" value={stats.chaletCount} />
          <StatCard label="Invitations this month" value={stats.invitationsThisMonth} />
          <StatCard label="Check-ins this month" value={stats.checkInsThisMonth} />
        </div>
      ) : null}
    </div>
  )
}
