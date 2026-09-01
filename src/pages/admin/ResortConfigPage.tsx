import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import type { Resort } from '../../types/database'

type ConfigTab = 'invites' | 'resale'

export function ResortConfigPage() {
  const { t } = useTranslation()
  const { resortId, refreshResort } = useAuth()

  const [tab, setTab] = useState<ConfigTab>('invites')
  const [resort, setResort] = useState<Resort | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [chaletWeekday, setChaletWeekday] = useState('')
  const [chaletWeekend, setChaletWeekend] = useState('')
  const [dailyCap, setDailyCap] = useState('')
  const [maxAdvanceDays, setMaxAdvanceDays] = useState('')
  const [flagChalet, setFlagChalet] = useState('')
  const [flagCabine, setFlagCabine] = useState('')

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
      setDailyCap(row.daily_invitation_cap != null ? String(row.daily_invitation_cap) : '')
      setMaxAdvanceDays(row.max_advance_days != null ? String(row.max_advance_days) : '')
      setFlagChalet(String(row.distinct_guests_flag_chalet ?? 20))
      setFlagCabine(String(row.distinct_guests_flag_cabine ?? 8))
    }

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  async function handleSave() {
    if (!resort || !resortId) return

    if (tab === 'invites') {
      const wd = Number(chaletWeekday)
      const we = Number(chaletWeekend)
      if (!Number.isFinite(wd) || wd < 0 || !Number.isFinite(we) || we < 0) {
        setError(t('config.invalidChaletLimits'))
        return
      }
    } else {
      if (dailyCap.trim() && Number(dailyCap) <= 0) {
        setError(t('config.invalidDailyCap'))
        return
      }
      if (maxAdvanceDays.trim() && Number(maxAdvanceDays) < 0) {
        setError(t('config.invalidAdvanceDays'))
        return
      }
      const fc = Number(flagChalet)
      const fcb = Number(flagCabine)
      if (!Number.isFinite(fc) || fc <= 0 || !Number.isFinite(fcb) || fcb <= 0) {
        setError(t('config.invalidFlagThreshold'))
        return
      }
    }

    setSaving(true)
    setError(null)
    setSuccess(false)

    const wd = Number(chaletWeekday) || 0
    const we = Number(chaletWeekend) || 0

    const { data, error: rpcError } = await supabase.rpc('update_resort_admin_settings', {
      p_resort_id: resortId,
      p_chalet_weekday_limit: wd,
      p_chalet_weekend_limit: we,
      p_daily_invitation_cap: dailyCap.trim() ? Number(dailyCap) : null,
      p_max_advance_days: maxAdvanceDays.trim() ? Number(maxAdvanceDays) : null,
      p_distinct_guests_flag_chalet: Number(flagChalet) || 20,
      p_distinct_guests_flag_cabine: Number(flagCabine) || 8,
    })

    if (rpcError) {
      setError(rpcError.message)
    } else {
      const payload = data as { error?: string; ok?: boolean } | null
      if (payload?.error) {
        setError(
          payload.error === 'NOT_AUTHORIZED'
            ? t('config.notAuthorized')
            : payload.error === 'INVALID_CHALET_LIMIT'
              ? t('config.invalidChaletLimits')
              : payload.error === 'INVALID_DAILY_CAP'
                ? t('config.invalidDailyCap')
                : payload.error === 'INVALID_ADVANCE_DAYS'
                  ? t('config.invalidAdvanceDays')
                  : payload.error === 'INVALID_FLAG_THRESHOLD'
                    ? t('config.invalidFlagThreshold')
                    : payload.error,
        )
      } else {
        setSuccess(true)
        await refreshResort()
        await loadConfig()
      }
    }
    setSaving(false)
  }

  function tabClass(active: boolean): string {
    return `rounded-lg px-3 py-2 text-sm font-medium transition ${
      active ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-gray-500 hover:bg-gray-50 hover:text-[#1A1A1A]'
    }`
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
        <p className="mt-1 text-sm text-gray-500">{t('config.subtitleAdmin', { name: resort.name })}</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-[#ECECEC] pb-3">
        <button type="button" className={tabClass(tab === 'invites')} onClick={() => setTab('invites')}>
          {t('config.tabInviteDefaults')}
        </button>
        <button type="button" className={tabClass(tab === 'resale')} onClick={() => setTab('resale')}>
          {t('config.tabResaleLimits')}
        </button>
      </div>

      <section className="space-y-5 rounded-2xl border border-[#ECECEC] bg-white p-6 shadow-sm">
        {tab === 'invites' ? (
          <>
            <h3 className="text-lg font-medium text-[#1A1A1A]">{t('config.defaultLimits')}</h3>
            <p className="text-sm text-gray-500">{t('config.chaletDefaultsHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t('config.chaletWeekday')}
                type="number"
                min={0}
                value={chaletWeekday}
                onChange={(e) => setChaletWeekday(e.target.value)}
              />
              <Input
                label={t('config.chaletWeekend')}
                type="number"
                min={0}
                value={chaletWeekend}
                onChange={(e) => setChaletWeekend(e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-medium text-[#1A1A1A]">{t('config.resaleTitle')}</h3>
            <p className="text-sm text-gray-500">{t('config.resaleHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t('config.dailyInvitationCap')}
                type="number"
                min={1}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                placeholder={t('config.unlimitedPlaceholder')}
              />
              <Input
                label={t('config.maxAdvanceDays')}
                type="number"
                min={0}
                value={maxAdvanceDays}
                onChange={(e) => setMaxAdvanceDays(e.target.value)}
                placeholder={t('config.unlimitedPlaceholder')}
              />
              <Input
                label={t('config.flagChalet')}
                type="number"
                min={1}
                value={flagChalet}
                onChange={(e) => setFlagChalet(e.target.value)}
              />
              <Input
                label={t('config.flagCabine')}
                type="number"
                min={1}
                value={flagCabine}
                onChange={(e) => setFlagCabine(e.target.value)}
              />
            </div>
            <p className="text-sm text-gray-500">{t('config.flagThresholdHint')}</p>
          </>
        )}

        {error ? (
          <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}
        {success ? (
          <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {t('config.saved')}
          </p>
        ) : null}

        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </section>
    </div>
  )
}
