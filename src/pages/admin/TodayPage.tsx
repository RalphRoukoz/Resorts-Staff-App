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
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Today &amp; Consumption</h2>
        <p className="mt-1 text-sm text-gray-500">
          Expected arrivals, check-ins, and this month&apos;s invitation counts.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <section>
        <h3 className="mb-3 text-lg font-medium text-[#1A1A1A]">Expected today</h3>
        <InvitationTable
          rows={expected}
          emptyMessage="No issued invitations for today."
          showValidatedAt={false}
        />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-[#1A1A1A]">Checked in today</h3>
        <InvitationTable
          rows={checkedIn}
          emptyMessage="No check-ins yet today."
          showValidatedAt
        />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-[#1A1A1A]">This month by status</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statusCounts.map((item) => (
            <div
              key={item.status}
              className="rounded-2xl border border-[#ECECEC] bg-white px-5 py-5 shadow-sm transition duration-200 hover:shadow-md"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{item.status}</p>
              <p className="tnum mt-2 text-3xl font-semibold tracking-tight text-[#1A1A1A]">{item.count}</p>
            </div>
          ))}
          {statusCounts.length === 0 ? (
            <p className="text-gray-400">No invitations this month.</p>
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
    <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
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
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id} className="transition hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-[#1A1A1A]">{row.invitee_name}</td>
              <td className="px-4 py-3 text-gray-600">{displayPhone(row.invitee_phone)}</td>
              <td className="px-4 py-3 text-gray-600">{row.assets.label}</td>
              <td className="px-4 py-3 text-gray-600">{formatDate(row.visit_date)}</td>
              {showValidatedAt ? (
                <td className="px-4 py-3 text-gray-600">
                  {row.validated_at ? formatDateTime(row.validated_at) : '—'}
                </td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={showValidatedAt ? 5 : 4}
                className="px-4 py-10 text-center text-gray-400"
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
