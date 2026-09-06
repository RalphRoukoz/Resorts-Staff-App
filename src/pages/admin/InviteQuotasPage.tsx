import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime, monthLabel } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { InvitationQuotaMode, InviteQuotaUnitRow } from '../../types/database'

type QuotaFilter = 'all' | 'not_handed' | 'handed' | 'chalet' | 'cabine'
type ModalAction = 'hand_over' | 'add' | 'remove'

interface QuotaListPayload {
  ok?: boolean
  error?: string
  period_ym?: string
  quota_mode?: InvitationQuotaMode
  units?: InviteQuotaUnitRow[]
}

interface QuotaEvent {
  id: string
  asset_id: string
  period_ym: string
  action: string
  weekday_delta: number
  weekend_delta: number
  actor_username: string | null
  note: string | null
  created_at: string
  unit_label: string
}

interface EventListPayload {
  ok?: boolean
  error?: string
  events?: QuotaEvent[]
}

interface QuotaModalState {
  action: ModalAction
  unit: InviteQuotaUnitRow
}

function parseAmount(value: string): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

export function InviteQuotasPage() {
  const { t } = useTranslation()
  const { resort, resortId } = useAuth()
  const [units, setUnits] = useState<InviteQuotaUnitRow[]>([])
  const [events, setEvents] = useState<QuotaEvent[]>([])
  const [periodYm, setPeriodYm] = useState('')
  const [payloadMode, setPayloadMode] = useState<InvitationQuotaMode>('automatic')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<QuotaFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<QuotaModalState | null>(null)
  const [weekday, setWeekday] = useState('0')
  const [weekend, setWeekend] = useState('0')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const quotaMode = resort?.invitation_quota_mode ?? payloadMode

  const loadData = useCallback(async () => {
    if (!resortId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    const [quotaResult, eventResult] = await Promise.all([
      supabase.rpc('list_resort_invite_quotas', { p_resort_id: resortId }),
      supabase.rpc('list_invitation_quota_events', { p_resort_id: resortId, p_limit: 100 }),
    ])

    if (quotaResult.error || eventResult.error) {
      setError(quotaResult.error?.message ?? eventResult.error?.message ?? t('inviteQuotas.loadFailed'))
      setLoading(false)
      return
    }

    const quotaPayload = quotaResult.data as QuotaListPayload | null
    const eventPayload = eventResult.data as EventListPayload | null
    if (quotaPayload?.error || eventPayload?.error) {
      setError(quotaPayload?.error ?? eventPayload?.error ?? t('inviteQuotas.loadFailed'))
      setLoading(false)
      return
    }

    setUnits(Array.isArray(quotaPayload?.units) ? quotaPayload.units : [])
    setEvents(Array.isArray(eventPayload?.events) ? eventPayload.events : [])
    setPeriodYm(quotaPayload?.period_ym ?? '')
    setPayloadMode(quotaPayload?.quota_mode ?? 'automatic')
    setLoading(false)
  }, [resortId, t])

  useEffect(() => {
    // Initial data is loaded from the external Supabase service.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  const filteredUnits = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return units.filter((unit) => {
      if (query && !unit.label.toLocaleLowerCase().includes(query)) return false
      if (filter === 'not_handed') return unit.status === 'not_handed'
      if (filter === 'handed') return unit.status === 'handed'
      if (filter === 'chalet' || filter === 'cabine') return unit.asset_type === filter
      return true
    })
  }, [filter, search, units])

  async function openModal(unit: InviteQuotaUnitRow, action: ModalAction) {
    let nextUnit = unit
    if (action === 'hand_over' && resortId) {
      // Refresh so hand-over prefills match latest superadmin resort defaults.
      const { data } = await supabase.rpc('list_resort_invite_quotas', { p_resort_id: resortId })
      const payload = data as QuotaListPayload | null
      if (payload && !payload.error && Array.isArray(payload.units)) {
        setUnits(payload.units)
        setPeriodYm(payload.period_ym ?? '')
        setPayloadMode(payload.quota_mode ?? 'automatic')
        nextUnit = payload.units.find((row) => row.asset_id === unit.asset_id) ?? unit
      }
    }
    setModal({ unit: nextUnit, action })
    setWeekday(action === 'hand_over' ? String(nextUnit.default_weekday) : '0')
    setWeekend(action === 'hand_over' ? String(nextUnit.default_weekend) : '0')
    setNote('')
    setFormError(null)
  }

  async function submitMutation() {
    if (!modal) return
    const weekdayAmount = parseAmount(weekday)
    const weekendAmount = parseAmount(weekend)
    if (modal.action !== 'hand_over' && weekdayAmount === 0 && weekendAmount === 0) {
      setFormError(t('inviteQuotas.enterAdjustment'))
      return
    }

    setSaving(true)
    setFormError(null)
    const result =
      modal.action === 'hand_over'
        ? await supabase.rpc('hand_over_asset_invite_quota', {
            p_asset: modal.unit.asset_id,
            p_weekday: weekdayAmount,
            p_weekend: weekendAmount,
            p_note: note.trim() || null,
          })
        : await supabase.rpc('adjust_asset_invite_quota', {
            p_asset: modal.unit.asset_id,
            p_weekday_delta: modal.action === 'remove' ? -weekdayAmount : weekdayAmount,
            p_weekend_delta: modal.action === 'remove' ? -weekendAmount : weekendAmount,
            p_note: note.trim() || null,
          })

    const payload = result.data as { error?: string } | null
    if (result.error || payload?.error) {
      setFormError(result.error?.message ?? payload?.error ?? t('inviteQuotas.saveFailed'))
      setSaving(false)
      return
    }

    setModal(null)
    setSaving(false)
    await loadData()
  }

  if (loading && units.length === 0) return <Spinner label={t('inviteQuotas.loading')} />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('inviteQuotas.title')}</h2>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-gray-600">
              {t(`inviteQuotas.mode.${quotaMode}`)}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">{t('inviteQuotas.subtitle')}</p>
          {periodYm ? <p className="mt-1 text-xs text-gray-400">{monthLabel(periodYm)} · {periodYm}</p> : null}
        </div>
        <Button variant="secondary" onClick={() => void loadData()} disabled={loading}>
          {loading ? t('inviteQuotas.refreshing') : t('inviteQuotas.refresh')}
        </Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Input
            label={t('inviteQuotas.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('inviteQuotas.searchPlaceholder')}
          />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">{t('inviteQuotas.filter')}</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as QuotaFilter)}
            className="rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
          >
            <option value="all">{t('inviteQuotas.filters.all')}</option>
            {quotaMode === 'manual' ? (
              <option value="not_handed">{t('inviteQuotas.filters.notHanded')}</option>
            ) : null}
            <option value="handed">{t('inviteQuotas.filters.handed')}</option>
            <option value="chalet">{t('inviteQuotas.filters.chalets')}</option>
            <option value="cabine">{t('inviteQuotas.filters.cabines')}</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">{t('inviteQuotas.columns.unit')}</th>
              <th className="px-4 py-3 font-medium">{t('inviteQuotas.columns.type')}</th>
              <th className="px-4 py-3 font-medium">{t('inviteQuotas.columns.weekday')}</th>
              <th className="px-4 py-3 font-medium">{t('inviteQuotas.columns.weekend')}</th>
              <th className="px-4 py-3 font-medium">{t('inviteQuotas.columns.used')}</th>
              <th className="px-4 py-3 font-medium">{t('inviteQuotas.columns.status')}</th>
              <th className="px-4 py-3 font-medium">{t('inviteQuotas.columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredUnits.map((unit) => (
              <tr key={unit.asset_id} className="transition hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-[#1A1A1A]">{unit.label}</td>
                <td className="px-4 py-3 capitalize text-gray-600">{unit.asset_type}</td>
                <td className="tnum px-4 py-3 text-gray-600">{unit.weekday_quota ?? '—'}</td>
                <td className="tnum px-4 py-3 text-gray-600">{unit.weekend_quota ?? '—'}</td>
                <td className="tnum px-4 py-3 text-gray-600">{unit.weekday_used} / {unit.weekend_used}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                    {t(`inviteQuotas.status.${unit.status}`)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {quotaMode === 'manual' && unit.status === 'not_handed' ? (
                    <Button onClick={() => void openModal(unit, 'hand_over')}>{t('inviteQuotas.handOver')}</Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => openModal(unit, 'add')}>{t('inviteQuotas.add')}</Button>
                      <Button variant="secondary" onClick={() => openModal(unit, 'remove')}>{t('inviteQuotas.remove')}</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filteredUnits.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">{t('inviteQuotas.empty')}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <section className="mt-10">
        <h3 className="text-lg font-semibold text-[#1A1A1A]">{t('inviteQuotas.activity')}</h3>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-3 font-medium">{t('inviteQuotas.eventColumns.date')}</th>
                <th className="px-4 py-3 font-medium">{t('inviteQuotas.eventColumns.user')}</th>
                <th className="px-4 py-3 font-medium">{t('inviteQuotas.eventColumns.action')}</th>
                <th className="px-4 py-3 font-medium">{t('inviteQuotas.eventColumns.unit')}</th>
                <th className="px-4 py-3 font-medium">{t('inviteQuotas.eventColumns.deltas')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDateTime(event.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600">{event.actor_username ?? '—'}</td>
                  <td className="px-4 py-3 capitalize text-gray-600">{event.action.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 font-medium text-[#1A1A1A]">{event.unit_label}</td>
                  <td className="tnum px-4 py-3 text-gray-600">
                    {event.weekday_delta >= 0 ? '+' : ''}{event.weekday_delta} / {event.weekend_delta >= 0 ? '+' : ''}{event.weekend_delta}
                  </td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">{t('inviteQuotas.noActivity')}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {modal ? (
        <Modal
          title={t(`inviteQuotas.modal.${modal.action}`, { unit: modal.unit.label })}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>{t('common.cancel')}</Button>
              <Button onClick={() => void submitMutation()} disabled={saving}>
                {saving ? t('common.saving') : t('inviteQuotas.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label={t('inviteQuotas.weekdayAmount')}
              type="number"
              min={0}
              value={weekday}
              onChange={(event) => setWeekday(event.target.value.replace(/[^\d]/g, ''))}
            />
            <Input
              label={t('inviteQuotas.weekendAmount')}
              type="number"
              min={0}
              value={weekend}
              onChange={(event) => setWeekend(event.target.value.replace(/[^\d]/g, ''))}
            />
            <Input label={t('inviteQuotas.note')} value={note} onChange={(event) => setNote(event.target.value)} />
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
