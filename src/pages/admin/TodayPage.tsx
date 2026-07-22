import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDate, formatDateTime, todayISO } from '../../lib/dates'
import { displayPhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { InvitationWithChalet } from '../../types/database'

type VisitorRow = {
  id: string
  visitor_name: string
  visitor_phone: string | null
  visit_date: string
  notes: string | null
  status: string
  assets: { label: string; resort_id: string } | null
}

export function TodayPage() {
  const { t } = useTranslation()
  const { resortId } = useAuth()
  const [expected, setExpected] = useState<InvitationWithChalet[]>([])
  const [checkedIn, setCheckedIn] = useState<InvitationWithChalet[]>([])
  const [visitors, setVisitors] = useState<VisitorRow[]>([])
  const [usedThisMonth, setUsedThisMonth] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [visitorQuery, setVisitorQuery] = useState('')

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const today = todayISO()
    const monthStart = `${today.slice(0, 7)}-01`
    const monthEndDate = new Date(`${today}T12:00:00`)
    monthEndDate.setMonth(monthEndDate.getMonth() + 1, 0)
    const monthEnd = monthEndDate.toISOString().slice(0, 10)

    const errors: string[] = []

    const expectedResult = await supabase
      .from('invitations')
      .select('*, assets!inner(label, resort_id)')
      .eq('assets.resort_id', resortId)
      .eq('visit_date', today)
      .eq('status', 'issued')
      .order('invitee_name')

    if (expectedResult.error) {
      errors.push(expectedResult.error.message)
    } else {
      setExpected((expectedResult.data ?? []) as InvitationWithChalet[])
    }

    const checkedInResult = await supabase
      .from('invitations')
      .select('*, assets!inner(label, resort_id)')
      .eq('assets.resort_id', resortId)
      .eq('status', 'validated')
      .gte('validated_at', `${today}T00:00:00`)
      .lt('validated_at', `${today}T23:59:59.999`)
      .order('validated_at', { ascending: false })

    if (checkedInResult.error) {
      errors.push(checkedInResult.error.message)
    } else {
      setCheckedIn((checkedInResult.data ?? []) as InvitationWithChalet[])
    }

    // Expire past announced visitors (idempotent) so desk stays clean.
    await supabase.rpc('expire_visitor_announcements')

    const visitorsResult = await supabase
      .from('visitor_announcements')
      .select('id, visitor_name, visitor_phone, visit_date, notes, status, assets(label, resort_id)')
      .eq('resort_id', resortId)
      .eq('visit_date', today)
      .eq('status', 'announced')
      .order('visitor_name')

    if (visitorsResult.error) {
      // Table may not exist until migration is applied — don't block Today.
      if (!/visitor_announcements|schema cache/i.test(visitorsResult.error.message)) {
        errors.push(visitorsResult.error.message)
      }
      setVisitors([])
    } else {
      setVisitors((visitorsResult.data ?? []) as unknown as VisitorRow[])
    }

    const monthResult = await supabase.rpc('resort_invitation_status_counts', {
      p_resort_id: resortId,
      p_date_from: monthStart,
      p_date_to: monthEnd,
    })

    if (monthResult.error) {
      const fallback = await supabase
        .from('invitations')
        .select('id, assets!inner(resort_id)', { count: 'exact', head: true })
        .eq('assets.resort_id', resortId)
        .eq('status', 'validated')
        .gte('validated_at', `${monthStart}T00:00:00`)
        .lte('validated_at', `${monthEnd}T23:59:59.999`)

      if (fallback.error) {
        errors.push(monthResult.error.message)
        setUsedThisMonth(0)
      } else {
        setUsedThisMonth(fallback.count ?? 0)
      }
    } else if (monthResult.data) {
      const rows = monthResult.data as Array<{ status: string; count: number }> | { error?: string }
      if (!Array.isArray(rows)) {
        if (typeof rows === 'object' && rows && 'error' in rows) {
          errors.push(String((rows as { error: string }).error))
        }
        setUsedThisMonth(0)
      } else {
        const validated = rows.find((r) => r.status === 'validated')
        setUsedThisMonth(validated?.count ?? rows.reduce((sum, r) => sum + r.count, 0))
      }
    }

    if (errors.length > 0) {
      setError(errors[0])
    }

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredVisitors = useMemo(() => {
    const q = visitorQuery.trim().toLowerCase()
    if (!q) return visitors
    return visitors.filter(
      (v) =>
        v.visitor_name.toLowerCase().includes(q) ||
        (v.visitor_phone ?? '').includes(q) ||
        (v.assets?.label ?? '').toLowerCase().includes(q),
    )
  }, [visitors, visitorQuery])

  async function markArrived(id: string) {
    setBusyId(id)
    const { error: rpcError } = await supabase.rpc('mark_visitor_arrived', { p_id: id })
    setBusyId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await loadData()
  }

  async function cancelVisitor(id: string) {
    setBusyId(id)
    const { error: rpcError } = await supabase.rpc('cancel_visitor', { p_id: id })
    setBusyId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await loadData()
  }

  if (loading) return <Spinner label={t('common.loading')} />

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('today.title')}</h2>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium text-[#1A1A1A]">{t('today.expectedVisitors')}</h3>
            <p className="mt-1 text-sm text-gray-500">{t('today.visitorsHint')}</p>
          </div>
          <input
            type="search"
            value={visitorQuery}
            onChange={(e) => setVisitorQuery(e.target.value)}
            placeholder={t('today.searchVisitors')}
            className="h-10 w-full max-w-xs rounded-xl border border-[#ECECEC] bg-white px-3 text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A]/30"
          />
        </div>
        <VisitorTable
          rows={filteredVisitors}
          emptyMessage={t('today.noExpectedVisitors')}
          busyId={busyId}
          onArrive={markArrived}
          onCancel={cancelVisitor}
          t={t}
        />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-[#1A1A1A]">{t('today.expected')}</h3>
        <InvitationTable rows={expected} emptyMessage={t('today.noExpected')} showValidatedAt={false} t={t} />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-[#1A1A1A]">{t('today.checkedIn')}</h3>
        <InvitationTable rows={checkedIn} emptyMessage={t('today.noCheckIns')} showValidatedAt t={t} />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-[#1A1A1A]">{t('today.usedThisMonth')}</h3>
        <div className="rounded-2xl border border-[#ECECEC] bg-white px-5 py-5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{t('today.validatedInvites')}</p>
          <p className="tnum mt-2 text-3xl font-semibold tracking-tight text-[#1A1A1A]">{usedThisMonth}</p>
        </div>
      </section>
    </div>
  )
}

function VisitorTable({
  rows,
  emptyMessage,
  busyId,
  onArrive,
  onCancel,
  t,
}: {
  rows: VisitorRow[]
  emptyMessage: string
  busyId: string | null
  onArrive: (id: string) => void
  onCancel: (id: string) => void
  t: (key: string) => string
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
          <tr>
            <th className="px-4 py-3 font-medium">{t('today.guest')}</th>
            <th className="px-4 py-3 font-medium">{t('today.phone')}</th>
            <th className="px-4 py-3 font-medium">{t('today.unit')}</th>
            <th className="px-4 py-3 font-medium">{t('today.notes')}</th>
            <th className="px-4 py-3 font-medium">{t('today.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id} className="transition hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-[#1A1A1A]">{row.visitor_name}</td>
              <td className="px-4 py-3 text-gray-600">{displayPhone(row.visitor_phone)}</td>
              <td className="px-4 py-3 text-gray-600">{row.assets?.label ?? '—'}</td>
              <td className="max-w-[14rem] truncate px-4 py-3 text-gray-600">{row.notes || '—'}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => onArrive(row.id)}
                    className="rounded-lg bg-[#1A1A1A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {t('today.markArrived')}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => onCancel(row.id)}
                    className="rounded-lg border border-[#ECECEC] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"
                  >
                    {t('today.cancelVisitor')}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function InvitationTable({
  rows,
  emptyMessage,
  showValidatedAt,
  t,
}: {
  rows: InvitationWithChalet[]
  emptyMessage: string
  showValidatedAt: boolean
  t: (key: string) => string
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
          <tr>
            <th className="px-4 py-3 font-medium">{t('today.guest')}</th>
            <th className="px-4 py-3 font-medium">{t('today.phone')}</th>
            <th className="px-4 py-3 font-medium">{t('today.unit')}</th>
            <th className="px-4 py-3 font-medium">{t('today.visitDate')}</th>
            {showValidatedAt ? (
              <th className="px-4 py-3 font-medium">{t('today.validatedAt')}</th>
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
