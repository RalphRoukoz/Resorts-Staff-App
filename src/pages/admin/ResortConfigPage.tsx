import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { DAY_LABELS } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { Resort } from '../../types/database'

export function ResortConfigPage() {
  const { resortId, refreshResort } = useAuth()

  const [resort, setResort] = useState<Resort | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [chaletWeekday, setChaletWeekday] = useState('')
  const [chaletWeekend, setChaletWeekend] = useState('')
  const [cabineWeekday, setCabineWeekday] = useState('')
  const [cabineWeekend, setCabineWeekend] = useState('')
  const [cabineInvitesEnabled, setCabineInvitesEnabled] = useState(true)
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
      setWeekendDays(Array.isArray(row.weekend_days) ? [...row.weekend_days] : [])
    }

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  function toggleDay(day: number) {
    setWeekendDays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b),
    )
  }

  async function handleSave() {
    if (!resort) return

    setSaving(true)
    setError(null)
    setSuccess(false)

    const { error: updateError } = await supabase
      .from('resorts')
      .update({
        chalet_weekday_limit: Number(chaletWeekday),
        chalet_weekend_limit: Number(chaletWeekend),
        cabine_weekday_limit: Number(cabineWeekday),
        cabine_weekend_limit: Number(cabineWeekend),
        cabine_invites_enabled: cabineInvitesEnabled,
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

  if (loading) return <Spinner label="Loading configuration…" />

  if (loadError || !resort) {
    return (
      <div className="max-w-2xl">
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {loadError ?? 'Unable to load resort configuration.'}
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => void loadConfig()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Resort Configuration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Invite limits and weekend days for {resort.name}.
        </p>
      </div>

      <section className="space-y-5 rounded-2xl border border-[#ECECEC] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-medium text-[#1A1A1A]">Cabine invitations</h3>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-300"
            checked={cabineInvitesEnabled}
            onChange={(e) => setCabineInvitesEnabled(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-[#1A1A1A]">Allow cabines to issue invitations</span>
            <span className="mt-0.5 block text-sm text-gray-500">
              When off, cabine owners and tenants cannot create guest invitations for this resort.
            </span>
          </span>
        </label>

        <h3 className="text-lg font-medium text-[#1A1A1A]">Default invite limits</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Chalet — weekday limit"
            type="number"
            min={0}
            value={chaletWeekday}
            onChange={(e) => setChaletWeekday(e.target.value)}
          />
          <Input
            label="Chalet — weekend limit"
            type="number"
            min={0}
            value={chaletWeekend}
            onChange={(e) => setChaletWeekend(e.target.value)}
          />
          <Input
            label="Cabine — weekday limit"
            type="number"
            min={0}
            value={cabineWeekday}
            onChange={(e) => setCabineWeekday(e.target.value)}
            disabled={!cabineInvitesEnabled}
          />
          <Input
            label="Cabine — weekend limit"
            type="number"
            min={0}
            value={cabineWeekend}
            onChange={(e) => setCabineWeekend(e.target.value)}
            disabled={!cabineInvitesEnabled}
          />
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">Weekend days</legend>
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

        {error ? (
          <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}
        {success ? (
          <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Configuration saved.
          </p>
        ) : null}

        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save configuration'}
        </Button>
      </section>
    </div>
  )
}
