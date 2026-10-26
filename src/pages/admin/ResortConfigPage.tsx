import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import type { Resort } from '../../types/database'

export function ResortConfigPage() {
  const { t } = useTranslation()
  const { resortId, refreshResort } = useAuth()

  const [resort, setResort] = useState<Resort | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [chaletWeekday, setChaletWeekday] = useState('')
  const [chaletWeekend, setChaletWeekend] = useState('')
  const [ownerTenantEnabled, setOwnerTenantEnabled] = useState(false)
  const [ownerWeekday, setOwnerWeekday] = useState('')
  const [ownerWeekend, setOwnerWeekend] = useState('')
  const [tenantWeekday, setTenantWeekday] = useState('')
  const [tenantWeekend, setTenantWeekend] = useState('')
  const [dailyCap, setDailyCap] = useState('')
  const [maxAdvanceDays, setMaxAdvanceDays] = useState('')

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
      setOwnerTenantEnabled(row.chalet_owner_tenant_limits_enabled ?? false)
      setOwnerWeekday(String(row.chalet_owner_weekday_limit ?? row.chalet_weekday_limit))
      setOwnerWeekend(String(row.chalet_owner_weekend_limit ?? row.chalet_weekend_limit))
      setTenantWeekday(String(row.chalet_tenant_weekday_limit ?? row.chalet_weekday_limit))
      setTenantWeekend(String(row.chalet_tenant_weekend_limit ?? row.chalet_weekend_limit))
      setDailyCap(row.daily_invitation_cap != null ? String(row.daily_invitation_cap) : '')
      setMaxAdvanceDays(row.max_advance_days != null ? String(row.max_advance_days) : '')
    }

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  function isNonNegative(value: string): boolean {
    const n = Number(value)
    return value.trim() !== '' && Number.isFinite(n) && n >= 0
  }

  async function handleSave() {
    if (!resort || !resortId) return

    const limits = ownerTenantEnabled
      ? [ownerWeekday, ownerWeekend, tenantWeekday, tenantWeekend]
      : [chaletWeekday, chaletWeekend]
    if (!limits.every(isNonNegative)) {
      setError(t('config.invalidChaletLimits'))
      return
    }
    if (dailyCap.trim() && !(Number(dailyCap) > 0)) {
      setError(t('config.invalidDailyCap'))
      return
    }
    if (maxAdvanceDays.trim() && !isNonNegative(maxAdvanceDays)) {
      setError(t('config.invalidAdvanceDays'))
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(false)

    const { data, error: rpcError } = await supabase.rpc('update_resort_admin_settings', {
      p_resort_id: resortId,
      p_chalet_weekday_limit: Number(chaletWeekday) || 0,
      p_chalet_weekend_limit: Number(chaletWeekend) || 0,
      p_daily_invitation_cap: dailyCap.trim() ? Number(dailyCap) : null,
      p_max_advance_days: maxAdvanceDays.trim() ? Number(maxAdvanceDays) : null,
      // Flag thresholds are managed by super admins; resend the stored values unchanged.
      p_distinct_guests_flag_chalet: resort.distinct_guests_flag_chalet ?? 20,
      p_distinct_guests_flag_cabine: resort.distinct_guests_flag_cabine ?? 8,
      p_chalet_owner_tenant_limits_enabled: ownerTenantEnabled,
      p_chalet_owner_weekday_limit: Number(ownerWeekday) || 0,
      p_chalet_owner_weekend_limit: Number(ownerWeekend) || 0,
      p_chalet_tenant_weekday_limit: Number(tenantWeekday) || 0,
      p_chalet_tenant_weekend_limit: Number(tenantWeekend) || 0,
    })

    if (rpcError) {
      setError(rpcError.message)
    } else {
      const payload = data as { error?: string; ok?: boolean } | null
      const errorKeys: Record<string, string> = {
        NOT_AUTHORIZED: 'config.notAuthorized',
        INVALID_CHALET_LIMIT: 'config.invalidChaletLimits',
        INVALID_DAILY_CAP: 'config.invalidDailyCap',
        INVALID_ADVANCE_DAYS: 'config.invalidAdvanceDays',
      }
      if (payload?.error) {
        setError(errorKeys[payload.error] ? t(errorKeys[payload.error]) : payload.error)
      } else {
        setSuccess(true)
        await refreshResort()
        await loadConfig()
      }
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
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('config.title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('config.subtitleAdmin', { name: resort.name })}</p>
      </div>

      <ConfigCard title={t('config.monthlyLimitsTitle')} hint={t('config.chaletDefaultsHint')}>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-300 accent-[var(--accent)]"
            checked={ownerTenantEnabled}
            onChange={(e) => {
              const enabled = e.target.checked
              setOwnerTenantEnabled(enabled)
              if (enabled) {
                setOwnerWeekday((prev) => prev || chaletWeekday)
                setOwnerWeekend((prev) => prev || chaletWeekend)
                setTenantWeekday((prev) => prev || chaletWeekday)
                setTenantWeekend((prev) => prev || chaletWeekend)
              }
            }}
          />
          <span>
            <span className="block text-sm font-medium text-[#1A1A1A]">{t('config.ownerTenantToggle')}</span>
            <span className="mt-0.5 block text-sm text-gray-500">{t('config.ownerTenantHint')}</span>
          </span>
        </label>

        {ownerTenantEnabled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label={t('config.ownerWeekday')} value={ownerWeekday} onChange={setOwnerWeekday} />
            <NumberField label={t('config.ownerWeekend')} value={ownerWeekend} onChange={setOwnerWeekend} />
            <NumberField label={t('config.tenantWeekday')} value={tenantWeekday} onChange={setTenantWeekday} />
            <NumberField label={t('config.tenantWeekend')} value={tenantWeekend} onChange={setTenantWeekend} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label={t('config.chaletWeekday')} value={chaletWeekday} onChange={setChaletWeekday} />
            <NumberField label={t('config.chaletWeekend')} value={chaletWeekend} onChange={setChaletWeekend} />
          </div>
        )}
      </ConfigCard>

      <ConfigCard title={t('config.dailyRulesTitle')} hint={t('config.dailyRulesHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <NumberField
              label={t('config.dailyInvitationCap')}
              value={dailyCap}
              onChange={setDailyCap}
              min={1}
              placeholder={t('config.unlimitedPlaceholder')}
            />
            <p className="mt-1.5 text-sm text-gray-500">{t('config.dailyInvitationCapHint')}</p>
          </div>
          <div>
            <NumberField
              label={t('config.maxAdvanceDays')}
              value={maxAdvanceDays}
              onChange={setMaxAdvanceDays}
              placeholder={t('config.unlimitedPlaceholder')}
            />
            <p className="mt-1.5 text-sm text-gray-500">{t('config.maxAdvanceDaysHint')}</p>
          </div>
        </div>
      </ConfigCard>

      {error ? (
        <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {t('config.saved')}
        </p>
      ) : null}

      <Button onClick={() => void handleSave()} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </Button>
    </div>
  )
}

function ConfigCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-[#ECECEC] bg-white p-6 shadow-sm">
      <div>
        <h3 className="text-lg font-medium text-[#1A1A1A]">{title}</h3>
        <p className="mt-1 text-sm text-gray-500">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  placeholder?: string
}) {
  return (
    <Input
      label={label}
      type="number"
      inputMode="numeric"
      min={min}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
