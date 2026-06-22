import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { DAY_LABELS } from '../../lib/dates'
import { supabase } from '../../lib/supabase'

export function SettingsPage() {
  const { resort, refreshResort } = useAuth()
  const [weekdayLimit, setWeekdayLimit] = useState('')
  const [weekendLimit, setWeekendLimit] = useState('')
  const [maxInvites, setMaxInvites] = useState('')
  const [weekendDays, setWeekendDays] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!resort) return
    setWeekdayLimit(String(resort.default_weekday_limit))
    setWeekendLimit(String(resort.default_weekend_limit))
    setMaxInvites(
      resort.max_invites_per_invitee_month != null
        ? String(resort.max_invites_per_invitee_month)
        : '',
    )
    setWeekendDays([...resort.weekend_days])
  }, [resort])

  function toggleDay(day: number) {
    setWeekendDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
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
        default_weekday_limit: Number(weekdayLimit),
        default_weekend_limit: Number(weekendLimit),
        max_invites_per_invitee_month: maxInvites ? Number(maxInvites) : null,
        weekend_days: weekendDays,
      })
      .eq('id', resort.id)

    if (updateError) setError(updateError.message)
    else {
      setSuccess(true)
      await refreshResort()
    }
    setSaving(false)
  }

  if (!resort) return <Spinner label="Loading settings…" />

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-white">Settings</h2>
        <p className="mt-1 text-sm text-slate-400">
          Resort defaults for {resort.name}. Leave max invites blank for no cap.
        </p>
      </div>

      <div className="space-y-5 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <Input
          label="Default weekday limit"
          type="number"
          min={0}
          value={weekdayLimit}
          onChange={(event) => setWeekdayLimit(event.target.value)}
        />
        <Input
          label="Default weekend limit"
          type="number"
          min={0}
          value={weekendLimit}
          onChange={(event) => setWeekendLimit(event.target.value)}
        />
        <Input
          label="Max invites per invitee per month (blank = no cap)"
          type="number"
          min={0}
          value={maxInvites}
          onChange={(event) => setMaxInvites(event.target.value)}
        />

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-300">Weekend days</legend>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((label, day) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(day)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  weekendDays.includes(day)
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {error ? (
          <p className="rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
        ) : null}
        {success ? (
          <p className="rounded-lg bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
            Settings saved.
          </p>
        ) : null}

        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </div>
  )
}
