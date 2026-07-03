import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { DAY_LABELS } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { PeriodAllowanceMode, Resort } from '../../types/database'

export function ResortConfigPage() {
  const { t } = useTranslation()
  const { resortId, refreshResort } = useAuth()

  const [resort, setResort] = useState<Resort | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [chaletWeekday, setChaletWeekday] = useState('')
  const [chaletWeekend, setChaletWeekend] = useState('')
  const [cabineWeekday, setCabineWeekday] = useState('')
  const [cabineWeekend, setCabineWeekend] = useState('')
  const [cabineInvitesEnabled, setCabineInvitesEnabled] = useState(true)
  const [cabineLimitInvites, setCabineLimitInvites] = useState(true)
  const [cabinePaidInvites, setCabinePaidInvites] = useState(false)
  const [chaletDoubleScan, setChaletDoubleScan] = useState(false)
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [periodAllowanceMode, setPeriodAllowanceMode] = useState<PeriodAllowanceMode>('monthly_within_period')
  const [weekendDays, setWeekendDays] = useState<number[]>([])

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadConfig = useCallback(async () => {
    if (!resortId) {
      setResort(null)
      setLoadError('No resort is assigned to this account.')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)

    const { data, error: fetchError } = await supabase.from('resorts').select('*').eq('id', resortId).single()

    if (fetchError) {
      setResort(null)
      setLoadError(fetchError.message)
    } else {
      const row = data as Resort
      setResort(row)
      setChaletWeekday(String(row.chalet_weekday_limit))
      setChaletWeekend(String(row.chalet_weekend_limit))
      setCabineWeekday(String(row.cabine_weekday_limit))
      setCabineWeekend(String(row.cabine_weekend_limit))
      setCabineInvitesEnabled(row.cabine_invites_enabled ?? true)
      setCabineLimitInvites(row.cabine_limit_invites ?? true)
      setCabinePaidInvites(row.cabine_paid_invites ?? false)
      setChaletDoubleScan(row.chalet_double_scan ?? false)
      setPeriodStart(row.invitation_period_start ?? '')
      setPeriodEnd(row.invitation_period_end ?? '')
      setPeriodAllowanceMode(row.period_allowance_mode ?? 'monthly_within_period')
      setWeekendDays(Array.isArray(row.weekend_days) ? [...row.weekend_days] : [])
    }

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  function toggleDay(day: number) {
    setWeekendDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b),
    )
  }

  async function handleSave() {
    if (!resort) return

    if (!periodStart || !periodEnd) {
      setError(t('config.seasonDatesRequired'))
      return
    }
    if (periodEnd < periodStart) {
      setError(t('config.seasonEndBeforeStart'))
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(false)

    const { error: updateError } = await supabase
      .from('resorts')
      .update({
        chalet_weekday_limit: Number(chaletWeekday) || 0,
        chalet_weekend_limit: Number(chaletWeekend) || 0,
        cabine_weekday_limit: Number(cabineWeekday) || 0,
        cabine_weekend_limit: Number(cabineWeekend) || 0,
        cabine_invites_enabled: cabineInvitesEnabled,
        cabine_limit_invites: cabineLimitInvites,
        cabine_paid_invites: cabinePaidInvites,
        chalet_double_scan: chaletDoubleScan,
        invitation_period_mode: 'whole_period',
        invitation_period_start: periodStart,
        invitation_period_end: periodEnd,
        period_allowance_mode: periodAllowanceMode,
        weekend_days: weekendDays,
      })
      .eq('id', resort.id)

    if (updateError) {
      setError(updateError.message)
    } else {
      setSuccess(true)
      await refreshResort()
      await loadConfig()
    }
    setSaving(false)
  }

  if (loading) return <Spinner label={t('config.loading')} />

  if (loadError || !resort) {
    return (
      <div className="max-w-2xl">
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {loadError ?? 'Unable to load resort configuration.'}
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => void loadConfig()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('config.title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('config.subtitle', { name: resort.name })}</p>
      </div>

      <section className="space-y-5 rounded-2xl border border-[#ECECEC] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-medium text-[#1A1A1A]">{t('config.seasonTitle')}</h3>
        <p className="text-sm text-gray-500">{t('config.seasonHint')}</p>
        <div className="space-y-4 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('config.seasonStart')} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            <Input label={t('config.seasonEnd')} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">{t('config.seasonAllowance')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-white px-4 py-3">
                <input
                  type="radio"
                  name="periodAllowance"
                  className="mt-0.5"
                  checked={periodAllowanceMode === 'monthly_within_period'}
                  onChange={() => setPeriodAllowanceMode('monthly_within_period')}
                />
                <span>
                  <span className="block text-sm font-medium text-[#1A1A1A]">{t('config.periodAllowanceMonthly')}</span>
                  <span className="mt-0.5 block text-sm text-gray-500">{t('config.periodAllowanceMonthlyHint')}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-white px-4 py-3">
                <input
                  type="radio"
                  name="periodAllowance"
                  className="mt-0.5"
                  checked={periodAllowanceMode === 'entire_period'}
                  onChange={() => setPeriodAllowanceMode('entire_period')}
                />
                <span>
                  <span className="block text-sm font-medium text-[#1A1A1A]">{t('config.periodAllowanceEntire')}</span>
                  <span className="mt-0.5 block text-sm text-gray-500">{t('config.periodAllowanceEntireHint')}</span>
                </span>
              </label>
            </div>
          </div>
        </div>

        <h3 className="text-lg font-medium text-[#1A1A1A]">{t('config.cabineInvites')}</h3>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-300"
            checked={cabineInvitesEnabled}
            onChange={(e) => setCabineInvitesEnabled(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-[#1A1A1A]">{t('config.allowCabine')}</span>
            <span className="mt-0.5 block text-sm text-gray-500">{t('config.allowCabineHint')}</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-300"
            checked={cabineLimitInvites}
            onChange={(e) => setCabineLimitInvites(e.target.checked)}
            disabled={!cabineInvitesEnabled}
          />
          <span>
            <span className="block text-sm font-medium text-[#1A1A1A]">{t('config.cabineLimitInvites')}</span>
            <span className="mt-0.5 block text-sm text-gray-500">{t('config.cabineLimitInvitesHint')}</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-300"
            checked={cabinePaidInvites}
            onChange={(e) => setCabinePaidInvites(e.target.checked)}
            disabled={!cabineInvitesEnabled}
          />
          <span>
            <span className="block text-sm font-medium text-[#1A1A1A]">{t('config.cabinePaid')}</span>
            <span className="mt-0.5 block text-sm text-gray-500">{t('config.cabinePaidHint')}</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-300"
            checked={chaletDoubleScan}
            onChange={(e) => setChaletDoubleScan(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-[#1A1A1A]">{t('config.chaletDoubleScan')}</span>
            <span className="mt-0.5 block text-sm text-gray-500">{t('config.chaletDoubleScanHint')}</span>
          </span>
        </label>

        <h3 className="text-lg font-medium text-[#1A1A1A]">{t('config.defaultLimits')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('config.chaletWeekday')} type="number" min={0} value={chaletWeekday} onChange={(e) => setChaletWeekday(e.target.value)} />
          <Input label={t('config.chaletWeekend')} type="number" min={0} value={chaletWeekend} onChange={(e) => setChaletWeekend(e.target.value)} />
          {cabineInvitesEnabled && cabineLimitInvites ? (
            <>
              <Input label={t('config.cabineWeekday')} type="number" min={0} value={cabineWeekday} onChange={(e) => setCabineWeekday(e.target.value)} />
              <Input label={t('config.cabineWeekend')} type="number" min={0} value={cabineWeekend} onChange={(e) => setCabineWeekend(e.target.value)} />
            </>
          ) : cabineInvitesEnabled ? (
            <p className="col-span-2 text-sm text-gray-500">{t('config.cabineUnlimitedNote')}</p>
          ) : null}
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">{t('config.weekendDays')}</legend>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((label, day) => {
              const active = weekendDays.includes(day)
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleDay(day)}
                  style={active ? { backgroundColor: 'var(--accent)' } : undefined}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    active ? 'text-white' : 'bg-gray-100 text-gray-500 hover:text-[#1A1A1A]'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </fieldset>

        {error ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
        {success ? (
          <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{t('config.saved')}</p>
        ) : null}

        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </section>
    </div>
  )
}
