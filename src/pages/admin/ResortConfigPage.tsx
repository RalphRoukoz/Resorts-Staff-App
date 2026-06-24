import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { DAY_LABELS } from '../../lib/dates'
import { supabase } from '../../lib/supabase'

const DEFAULT_BRAND = '#0ea5e9'
const LOGO_BUCKET = 'resort-logos'

export function ResortConfigPage() {
  const { resort, refreshResort } = useAuth()

  const [chaletWeekday, setChaletWeekday] = useState('')
  const [chaletWeekend, setChaletWeekend] = useState('')
  const [cabineWeekday, setCabineWeekday] = useState('')
  const [cabineWeekend, setCabineWeekend] = useState('')
  const [weekendDays, setWeekendDays] = useState<number[]>([])
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_BRAND)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!resort) return
    setChaletWeekday(String(resort.chalet_weekday_limit))
    setChaletWeekend(String(resort.chalet_weekend_limit))
    setCabineWeekday(String(resort.cabine_weekday_limit))
    setCabineWeekend(String(resort.cabine_weekend_limit))
    setWeekendDays([...resort.weekend_days])
    setPrimaryColor(resort.primary_color || DEFAULT_BRAND)
    setLogoUrl(resort.logo_url)
  }, [resort])

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

    let nextLogoUrl = logoUrl

    // Upload a new logo if one was picked.
    if (logoFile) {
      const ext = logoFile.name.split('.').pop() || 'png'
      const path = `${resort.id}/logo-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, logoFile, { upsert: false, contentType: logoFile.type })

      if (uploadError) {
        setError(`Logo upload failed: ${uploadError.message}`)
        setSaving(false)
        return
      }

      const { data: publicData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
      nextLogoUrl = publicData.publicUrl
    }

    const { error: updateError } = await supabase
      .from('resorts')
      .update({
        chalet_weekday_limit: Number(chaletWeekday),
        chalet_weekend_limit: Number(chaletWeekend),
        cabine_weekday_limit: Number(cabineWeekday),
        cabine_weekend_limit: Number(cabineWeekend),
        weekend_days: weekendDays,
        primary_color: primaryColor,
        logo_url: nextLogoUrl,
      })
      .eq('id', resort.id)

    if (updateError) {
      setError(updateError.message)
    } else {
      setSuccess(true)
      setLogoUrl(nextLogoUrl)
      setLogoFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await refreshResort()
    }
    setSaving(false)
  }

  if (!resort) return <Spinner label="Loading configuration…" />

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-white">Resort Configuration</h2>
        <p className="mt-1 text-sm text-slate-400">
          Limits, weekend days, and branding for {resort.name}.
        </p>
      </div>

      <div className="space-y-8">
        {/* Limits */}
        <section className="space-y-5 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <h3 className="text-lg font-medium text-white">Default invite limits</h3>
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
            />
            <Input
              label="Cabine — weekend limit"
              type="number"
              min={0}
              value={cabineWeekend}
              onChange={(e) => setCabineWeekend(e.target.value)}
            />
          </div>

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
        </section>

        {/* Branding */}
        <section className="space-y-5 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <h3 className="text-lg font-medium text-white">Branding</h3>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-300">Logo</span>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Resort logo"
                  className="h-14 w-auto max-w-[160px] rounded bg-slate-950 object-contain p-1"
                />
              ) : (
                <div className="flex h-14 w-28 items-center justify-center rounded bg-slate-950 text-xs text-slate-500">
                  No logo
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                className="block text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600"
              />
            </div>
            {logoFile ? (
              <p className="mt-2 text-xs text-slate-400">Selected: {logoFile.name}</p>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">Primary color</span>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border border-slate-700 bg-slate-900"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </label>
        </section>

        {error ? (
          <p className="rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
        ) : null}
        {success ? (
          <p className="rounded-lg bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
            Configuration saved.
          </p>
        ) : null}

        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save configuration'}
        </Button>
      </div>
    </div>
  )
}
