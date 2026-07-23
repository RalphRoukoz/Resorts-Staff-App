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
  arrived_at: string | null
  assets: { label: string; resort_id: string } | null
}

type DeskLane = 'visitors' | 'invitations'
type VisitorStatus = 'expected' | 'arrived'
type InviteStatus = 'expected' | 'checked_in'

export function TodayPage() {
  const { t } = useTranslation()
  const { resortId } = useAuth()
  const [expected, setExpected] = useState<InvitationWithChalet[]>([])
  const [checkedIn, setCheckedIn] = useState<InvitationWithChalet[]>([])
  const [visitors, setVisitors] = useState<VisitorRow[]>([])
  const [usedThisMonth, setUsedThisMonth] = useState(0)
  const [visitorsArrivedMonth, setVisitorsArrivedMonth] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lane, setLane] = useState<DeskLane>('visitors')
  const [visitorStatus, setVisitorStatus] = useState<VisitorStatus>('expected')
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('expected')

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

    if (expectedResult.error) errors.push(expectedResult.error.message)
    else setExpected((expectedResult.data ?? []) as InvitationWithChalet[])

    const checkedInResult = await supabase
      .from('invitations')
      .select('*, assets!inner(label, resort_id)')
      .eq('assets.resort_id', resortId)
      .eq('status', 'validated')
      .gte('validated_at', `${today}T00:00:00`)
      .lt('validated_at', `${today}T23:59:59.999`)
      .order('validated_at', { ascending: false })

    if (checkedInResult.error) errors.push(checkedInResult.error.message)
    else setCheckedIn((checkedInResult.data ?? []) as InvitationWithChalet[])

    await supabase.rpc('expire_visitor_announcements')

    const visitorsResult = await supabase
      .from('visitor_announcements')
      .select('id, visitor_name, visitor_phone, visit_date, notes, status, arrived_at, assets(label, resort_id)')
      .eq('resort_id', resortId)
      .eq('visit_date', today)
      .in('status', ['announced', 'arrived'])
      .order('visitor_name')

    if (visitorsResult.error) {
      if (!/visitor_announcements|schema cache/i.test(visitorsResult.error.message)) {
        errors.push(visitorsResult.error.message)
      }
      setVisitors([])
    } else {
      setVisitors((visitorsResult.data ?? []) as unknown as VisitorRow[])
    }

    const monthVisitors = await supabase
      .from('visitor_announcements')
      .select('id', { count: 'exact', head: true })
      .eq('resort_id', resortId)
      .eq('status', 'arrived')
      .gte('visit_date', monthStart)
      .lte('visit_date', monthEnd)

    if (!monthVisitors.error) setVisitorsArrivedMonth(monthVisitors.count ?? 0)

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

    if (errors.length > 0) setError(errors[0])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const expectedVisitors = useMemo(
    () => visitors.filter((v) => v.status === 'announced'),
    [visitors],
  )
  const arrivedVisitors = useMemo(() => {
    const rows = visitors.filter((v) => v.status === 'arrived')
    return [...rows].sort((a, b) => (b.arrived_at ?? '').localeCompare(a.arrived_at ?? ''))
  }, [visitors])

  const visitorRows = visitorStatus === 'expected' ? expectedVisitors : arrivedVisitors
  const inviteRows = inviteStatus === 'expected' ? expected : checkedIn

  const filteredVisitors = useMemo(() => filterByQuery(visitorRows, query, 'visitor'), [visitorRows, query])
  const filteredInvites = useMemo(() => filterByQuery(inviteRows, query, 'invite'), [inviteRows, query])

  async function markArrived(id: string) {
    setBusyId(id)
    const { error: rpcError } = await supabase.rpc('mark_visitor_arrived', { p_id: id })
    setBusyId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setLane('visitors')
    setVisitorStatus('arrived')
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

  const todayLabel = formatDate(todayISO())

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('today.title')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('today.subtitle', { date: todayLabel })}</p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-2xl border border-[#ECECEC] bg-white px-4 py-3 shadow-sm">
          <MonthStat label={t('today.monthInvites')} value={usedThisMonth} />
          <div className="mx-1 hidden h-8 w-px bg-[#ECECEC] sm:block" aria-hidden />
          <MonthStat label={t('today.monthVisitors')} value={visitorsArrivedMonth} />
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryChip
          label={t('today.kpiVisitorsWaiting')}
          value={expectedVisitors.length}
          active={lane === 'visitors' && visitorStatus === 'expected'}
          onClick={() => {
            setLane('visitors')
            setVisitorStatus('expected')
          }}
        />
        <SummaryChip
          label={t('today.kpiVisitorsArrived')}
          value={arrivedVisitors.length}
          active={lane === 'visitors' && visitorStatus === 'arrived'}
          onClick={() => {
            setLane('visitors')
            setVisitorStatus('arrived')
          }}
        />
        <SummaryChip
          label={t('today.kpiInvitesExpected')}
          value={expected.length}
          active={lane === 'invitations' && inviteStatus === 'expected'}
          onClick={() => {
            setLane('invitations')
            setInviteStatus('expected')
          }}
        />
        <SummaryChip
          label={t('today.kpiInvitesCheckedIn')}
          value={checkedIn.length}
          active={lane === 'invitations' && inviteStatus === 'checked_in'}
          onClick={() => {
            setLane('invitations')
            setInviteStatus('checked_in')
          }}
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#ECECEC] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedControl
            ariaLabel={t('today.laneLabel')}
            value={lane}
            onChange={(next) => {
              setLane(next)
              setQuery('')
            }}
            options={[
              { value: 'visitors', label: t('today.laneVisitors') },
              { value: 'invitations', label: t('today.laneInvitations') },
            ]}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              lane === 'visitors' ? t('today.searchVisitors') : t('today.searchInvitations')
            }
            className="h-11 w-full max-w-sm rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-3 text-[16px] text-[#1A1A1A] outline-none focus:border-[#1A1A1A]/30 focus:bg-white"
          />
        </div>

        <div className="border-b border-[#ECECEC] px-4 py-3">
          {lane === 'visitors' ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusTabs
                ariaLabel={t('today.visitorStatusLabel')}
                value={visitorStatus}
                onChange={setVisitorStatus}
                options={[
                  {
                    value: 'expected',
                    label: t('today.expectedVisitors'),
                    count: expectedVisitors.length,
                  },
                  {
                    value: 'arrived',
                    label: t('today.arrivedVisitors'),
                    count: arrivedVisitors.length,
                  },
                ]}
              />
              <p className="text-xs text-gray-500">{t('today.visitorsHint')}</p>
            </div>
          ) : (
            <StatusTabs
              ariaLabel={t('today.inviteStatusLabel')}
              value={inviteStatus}
              onChange={setInviteStatus}
              options={[
                { value: 'expected', label: t('today.inviteExpected'), count: expected.length },
                {
                  value: 'checked_in',
                  label: t('today.inviteCheckedIn'),
                  count: checkedIn.length,
                },
              ]}
            />
          )}
        </div>

        <div className="p-0">
          {lane === 'visitors' ? (
            <VisitorTable
              rows={filteredVisitors}
              mode={visitorStatus}
              emptyMessage={
                visitorStatus === 'expected'
                  ? t('today.noExpectedVisitors')
                  : t('today.noArrivedVisitors')
              }
              busyId={busyId}
              onArrive={markArrived}
              onCancel={cancelVisitor}
              t={t}
            />
          ) : (
            <InvitationTable
              rows={filteredInvites}
              emptyMessage={
                inviteStatus === 'expected' ? t('today.noExpected') : t('today.noCheckIns')
              }
              showValidatedAt={inviteStatus === 'checked_in'}
              t={t}
            />
          )}
        </div>
      </section>
    </div>
  )
}

function filterByQuery<T extends VisitorRow | InvitationWithChalet>(
  rows: T[],
  query: string,
  kind: 'visitor' | 'invite',
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) => {
    if (kind === 'visitor') {
      const v = row as VisitorRow
      return (
        v.visitor_name.toLowerCase().includes(q) ||
        (v.visitor_phone ?? '').includes(q) ||
        (v.assets?.label ?? '').toLowerCase().includes(q)
      )
    }
    const i = row as InvitationWithChalet
    return (
      i.invitee_name.toLowerCase().includes(q) ||
      (i.invitee_phone ?? '').includes(q) ||
      i.assets.label.toLowerCase().includes(q)
    )
  })
}

function MonthStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[7rem]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className="tnum mt-0.5 text-xl font-semibold tracking-tight text-[#1A1A1A]">{value}</p>
    </div>
  )
}

function SummaryChip({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3.5 text-start transition ${
        active
          ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white shadow-sm'
          : 'border-[#ECECEC] bg-white text-[#1A1A1A] shadow-sm hover:border-gray-300'
      }`}
    >
      <p className={`text-xs font-medium ${active ? 'text-white/70' : 'text-gray-500'}`}>{label}</p>
      <p className="tnum mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </button>
  )
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string }[]
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex rounded-xl bg-gray-100 p-1">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition ${
              active ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-gray-500 hover:text-[#1A1A1A]'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function StatusTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string; count: number }[]
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition ${
              active
                ? 'bg-[#1A1A1A] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-[#1A1A1A]'
            }`}
          >
            {opt.label}
            <span
              className={`inline-flex min-w-5 justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                active ? 'bg-white/20 text-white' : 'bg-white text-gray-600'
              }`}
            >
              {opt.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function VisitorTable({
  rows,
  mode,
  emptyMessage,
  busyId,
  onArrive,
  onCancel,
  t,
}: {
  rows: VisitorRow[]
  mode: VisitorStatus
  emptyMessage: string
  busyId: string | null
  onArrive: (id: string) => void
  onCancel: (id: string) => void
  t: (key: string) => string
}) {
  const isArrived = mode === 'arrived'

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
          <tr>
            <th className="px-4 py-3 font-medium">{t('today.guest')}</th>
            <th className="px-4 py-3 font-medium">{t('today.phone')}</th>
            <th className="px-4 py-3 font-medium">{t('today.unit')}</th>
            {isArrived ? (
              <th className="px-4 py-3 font-medium">{t('today.arrivedAt')}</th>
            ) : (
              <th className="px-4 py-3 font-medium">{t('today.notes')}</th>
            )}
            {isArrived ? (
              <th className="px-4 py-3 font-medium">{t('today.notes')}</th>
            ) : (
              <th className="px-4 py-3 font-medium">{t('today.actions')}</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id} className="transition hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-[#1A1A1A]">{row.visitor_name}</td>
              <td className="px-4 py-3 text-gray-600">{displayPhone(row.visitor_phone)}</td>
              <td className="px-4 py-3 text-gray-600">{row.assets?.label ?? '—'}</td>
              {isArrived ? (
                <td className="px-4 py-3 text-gray-600">
                  {row.arrived_at ? formatDateTime(row.arrived_at) : '—'}
                </td>
              ) : (
                <td className="max-w-[14rem] truncate px-4 py-3 text-gray-600">{row.notes || '—'}</td>
              )}
              {isArrived ? (
                <td className="max-w-[14rem] truncate px-4 py-3 text-gray-600">{row.notes || '—'}</td>
              ) : (
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => onArrive(row.id)}
                      className="min-h-10 rounded-lg bg-[#1A1A1A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {t('today.markArrived')}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => onCancel(row.id)}
                      className="min-h-10 rounded-lg border border-[#ECECEC] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"
                    >
                      {t('today.cancelVisitor')}
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
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
    <div className="overflow-x-auto">
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
                className="px-4 py-12 text-center text-gray-400"
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
