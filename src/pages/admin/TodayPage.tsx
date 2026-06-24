import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDate, formatDateTime, todayISO } from '../../lib/dates'
import { displayPhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { InvitationWithChalet, StatusCount } from '../../types/database'

export function TodayPage() {
  const { resortId } = useAuth()
  const [expected, setExpected] = useState<InvitationWithChalet[]>([])
  const [checkedIn, setCheckedIn] = useState<InvitationWithChalet[]>([])
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const today = todayISO()
    const monthStart = `${today.slice(0, 7)}-01`
    const monthEndDate = new Date(today + 'T12:00:00')
    monthEndDate.setMonth(monthEndDate.getMonth() + 1, 0)
    const monthEnd = monthEndDate.toISOString().slice(0, 10)

    const [expectedResult, checkedInResult, monthResult] = await Promise.all([
      supabase
        .from('invitations')
        .select('*, assets!inner(label, resort_id)')
        .eq('assets.resort_id', resortId)
        .eq('visit_date', today)
        .eq('status', 'issued')
        .order('invitee_name'),
      supabase
        .from('invitations')
        .select('*, assets!inner(label, resort_id)')
        .eq('assets.resort_id', resortId)
        .eq('status', 'validated')
        .gte('validated_at', `${today}T00:00:00`)
        .lt('validated_at', `${today}T23:59:59.999`)
        .order('validated_at', { ascending: false }),
      supabase
        .from('invitations')
        .select('status, assets!inner(resort_id)')
        .eq('assets.resort_id', resortId)
        .gte('visit_date', monthStart)
        .lte('visit_date', monthEnd),
    ])

    if (expectedResult.error) {
      setError(expectedResult.error.message)
    } else {
      setExpected((expectedResult.data ?? []) as InvitationWithChalet[])
    }

    if (checkedInResult.error) {
      setError(checkedInResult.error.message)
    } else {
      setCheckedIn((checkedInResult.data ?? []) as InvitationWithChalet[])
    }

    if (monthResult.data) {
      const counts = new Map<string, number>()
      for (const row of monthResult.data) {
        const status = row.status as string
        counts.set(status, (counts.get(status) ?? 0) + 1)
      }
      setStatusCounts(
        Array.from(counts.entries()).map(([status, count]) => ({
          status: status as StatusCount['status'],
          count,
        })),
      )
    }

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (loading) return <Spinner label="Loading today&apos;s data…" />

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white">Today &amp; Consumption</h2>
        <p className="mt-1 text-sm text-slate-400">
          Expected arrivals, check-ins, and this month&apos;s invitation counts.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      <section>
        <h3 className="mb-3 text-lg font-medium text-white">Expected today</h3>
        <InvitationTable
          rows={expected}
          emptyMessage="No issued invitations for today."
          showValidatedAt={false}
        />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-white">Checked in today</h3>
        <InvitationTable
          rows={checkedIn}
          emptyMessage="No check-ins yet today."
          showValidatedAt
        />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-white">This month by status</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statusCounts.map((item) => (
            <div
              key={item.status}
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-5"
            >
              <p className="text-sm capitalize text-slate-400">{item.status}</p>
              <p className="mt-1 text-3xl font-semibold text-white">{item.count}</p>
            </div>
          ))}
          {statusCounts.length === 0 ? (
            <p className="text-slate-500">No invitations this month.</p>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function InvitationTable({
  rows,
  emptyMessage,
  showValidatedAt,
}: {
  rows: InvitationWithChalet[]
  emptyMessage: string
  showValidatedAt: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-900 text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium">Invitee</th>
            <th className="px-4 py-3 font-medium">Phone</th>
            <th className="px-4 py-3 font-medium">Chalet</th>
            <th className="px-4 py-3 font-medium">Visit date</th>
            {showValidatedAt ? (
              <th className="px-4 py-3 font-medium">Validated at</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row) => (
            <tr key={row.id} className="bg-slate-950/50">
              <td className="px-4 py-3 font-medium text-white">{row.invitee_name}</td>
              <td className="px-4 py-3 text-slate-300">{displayPhone(row.invitee_phone)}</td>
              <td className="px-4 py-3 text-slate-300">{row.assets.label}</td>
              <td className="px-4 py-3 text-slate-300">{formatDate(row.visit_date)}</td>
              {showValidatedAt ? (
                <td className="px-4 py-3 text-slate-300">
                  {row.validated_at ? formatDateTime(row.validated_at) : '—'}
                </td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={showValidatedAt ? 5 : 4}
                className="px-4 py-8 text-center text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
