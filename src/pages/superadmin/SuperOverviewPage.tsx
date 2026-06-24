import { useEffect, useState } from 'react'
import { Spinner } from '../../components/ui/Spinner'
import { todayISO } from '../../lib/dates'
import { supabase } from '../../lib/supabase'

interface PlatformStats {
  resortCount: number
  chaletCount: number
  invitationsThisMonth: number
  checkInsThisMonth: number
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#ECECEC] bg-white px-6 py-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight text-[#1A1A1A]">{value}</p>
    </div>
  )
}

export function SuperOverviewPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      const today = todayISO()
      const monthStart = `${today.slice(0, 7)}-01`

      const [resortResult, chaletResult, invitesResult, checkInsResult] = await Promise.all([
        supabase.from('resorts').select('*', { count: 'exact', head: true }),
        supabase.from('assets').select('*', { count: 'exact', head: true }),
        supabase
          .from('invitations')
          .select('*', { count: 'exact', head: true })
          .gte('visit_date', monthStart),
        supabase
          .from('invitations')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'validated')
          .gte('validated_at', `${monthStart}T00:00:00`),
      ])

      const firstError =
        resortResult.error ??
        chaletResult.error ??
        invitesResult.error ??
        checkInsResult.error

      if (firstError) {
        setError(firstError.message)
        setLoading(false)
        return
      }

      setStats({
        resortCount: resortResult.count ?? 0,
        chaletCount: chaletResult.count ?? 0,
        invitationsThisMonth: invitesResult.count ?? 0,
        checkInsThisMonth: checkInsResult.count ?? 0,
      })
      setLoading(false)
    }

    void load()
  }, [])

  if (loading) return <Spinner label="Loading overview…" />

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-[#1A1A1A]">Overview</h2>
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
