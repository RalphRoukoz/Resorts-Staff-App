import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { DAY_LABELS } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { ResortWithStats } from '../../types/database'

const DEFAULT_ACCENT = '#1A1A1A'
const LOGO_BUCKET = 'resort-logos'

interface ResortForm {
  name: string
  chalet_weekday_limit: string
  chalet_weekend_limit: string
  cabine_weekday_limit: string
  cabine_weekend_limit: string
  cabine_invites_enabled: boolean
  cabine_paid_invites: boolean
  chalet_double_scan: boolean
  invitation_period_mode: 'monthly' | 'whole_period'
  weekend_days: number[]
  primary_color: string
  logo_url: string | null
}

const emptyForm: ResortForm = {
  name: '',
  chalet_weekday_limit: '8',
  chalet_weekend_limit: '3',
  cabine_weekday_limit: '8',
  cabine_weekend_limit: '3',
  cabine_invites_enabled: true,
  cabine_paid_invites: false,
  chalet_double_scan: false,
  invitation_period_mode: 'monthly',
  weekend_days: [5, 6],
  primary_color: DEFAULT_ACCENT,
  logo_url: null,
}

function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b)
}

export function SuperResortsPage() {
  const [resorts, setResorts] = useState<ResortWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ResortForm>(emptyForm)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ResortWithStats | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const logoPreview = useMemo(
    () => (logoFile ? URL.createObjectURL(logoFile) : form.logo_url),
    [logoFile, form.logo_url],
  )

  useEffect(() => {
    return () => {
      if (logoFile && logoPreview) URL.revokeObjectURL(logoPreview)
    }
  }, [logoFile, logoPreview])

  const loadResorts = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase.rpc('super_resorts_with_stats')

    if (fetchError) {
      setError(fetchError.message)
      setResorts([])
      setLoading(false)
      return
    }

    const payload = data as ResortWithStats[] | { error?: string }
    if (!Array.isArray(payload)) {
      if (payload?.error === 'NOT_AUTHORIZED') {
        setError('You do not have permission to view resorts.')
      } else {
        setError('Failed to load resorts.')
      }
      setResorts([])
      setLoading(false)
      return
    }

    setResorts(payload)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadResorts()
  }, [loadResorts])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setLogoFile(null)
    setFormError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setModalOpen(true)
  }

  function openEdit(resort: ResortWithStats) {
    setEditingId(resort.id)
    setForm({
      name: resort.name,
      chalet_weekday_limit: String(resort.chalet_weekday_limit),
      chalet_weekend_limit: String(resort.chalet_weekend_limit),
      cabine_weekday_limit: String(resort.cabine_weekday_limit),
      cabine_weekend_limit: String(resort.cabine_weekend_limit),
      cabine_invites_enabled: resort.cabine_invites_enabled,
      cabine_paid_invites: resort.cabine_paid_invites ?? false,
      chalet_double_scan: resort.chalet_double_scan ?? false,
      invitation_period_mode: resort.invitation_period_mode ?? 'monthly',
      weekend_days: [...resort.weekend_days],
      primary_color: resort.primary_color || DEFAULT_ACCENT,
      logo_url: resort.logo_url,
    })
    setLogoFile(null)
    setFormError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }

    setSaving(true)
    setFormError(null)

    let nextLogoUrl = form.logo_url

    if (logoFile) {
      const ext = logoFile.name.split('.').pop() || 'png'
      const folder = editingId ?? 'new'
      const path = `${folder}/logo-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, logoFile, { upsert: false, contentType: logoFile.type })

      if (uploadError) {
        setFormError(`Logo upload failed: ${uploadError.message}`)
        setSaving(false)
        return
      }

      const { data: publicData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
      nextLogoUrl = publicData.publicUrl
    }

    const payload = {
      name: form.name.trim(),
      chalet_weekday_limit: Number(form.chalet_weekday_limit),
      chalet_weekend_limit: Number(form.chalet_weekend_limit),
      cabine_weekday_limit: Number(form.cabine_weekday_limit),
      cabine_weekend_limit: Number(form.cabine_weekend_limit),
      cabine_invites_enabled: form.cabine_invites_enabled,
      cabine_paid_invites: form.cabine_paid_invites,
      chalet_double_scan: form.chalet_double_scan,
      invitation_period_mode: form.invitation_period_mode,
      weekend_days: form.weekend_days,
      primary_color: form.primary_color,
      logo_url: nextLogoUrl,
    }

    if (editingId) {
      const { error: updateError } = await supabase
        .from('resorts')
        .update(payload)
        .eq('id', editingId)
      if (updateError) {
        setFormError(updateError.message)
        setSaving(false)
        return
      }
    } else {
      const { error: insertError } = await supabase.from('resorts').insert(payload)
      if (insertError) {
        setFormError(insertError.message)
        setSaving(false)
        return
      }
    }

    setModalOpen(false)
    setSaving(false)
    await loadResorts()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)

    const { error: deleteError } = await supabase
      .from('resorts')
      .delete()
      .eq('id', deleteTarget.id)

    if (deleteError) setError(deleteError.message)
    else {
      setDeleteTarget(null)
      await loadResorts()
    }
    setDeleting(false)
  }

  if (loading) return <Spinner label="Loading resorts…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Resorts</h2>
          <p className="mt-1 text-sm text-gray-500">All resorts on the platform.</p>
        </div>
        <Button onClick={openCreate}>Add resort</Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Resort</th>
              <th className="px-4 py-3 font-medium">Units</th>
              <th className="px-4 py-3 font-medium">Invitations</th>
              <th className="px-4 py-3 font-medium">Chalet (wd/we)</th>
              <th className="px-4 py-3 font-medium">Cabine (wd/we)</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {resorts.map((resort) => (
              <tr key={resort.id} className="transition hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {resort.logo_url ? (
                      <img
                        src={resort.logo_url}
                        alt={resort.name}
                        className="h-8 w-8 rounded-lg border border-[#ECECEC] object-contain"
                      />
                    ) : (
                      <span
                        className="inline-block h-8 w-8 rounded-lg border border-[#ECECEC]"
                        style={{ backgroundColor: resort.primary_color || DEFAULT_ACCENT }}
                      />
                    )}
                    <span className="font-medium text-[#1A1A1A]">{resort.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{resort.chalet_count}</td>
                <td className="px-4 py-3 text-gray-600">{resort.invitation_count}</td>
                <td className="px-4 py-3 text-gray-600">
                  {resort.chalet_weekday_limit} / {resort.chalet_weekend_limit}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {resort.cabine_weekday_limit} / {resort.cabine_weekend_limit}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => openEdit(resort)}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => setDeleteTarget(resort)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {resorts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  No resorts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Create / Edit modal */}
      {modalOpen ? (
        <Modal
          title={editingId ? 'Edit resort' : 'Add resort'}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <Input
              label="Resort name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300"
                checked={form.cabine_invites_enabled}
                onChange={(e) => setForm({ ...form, cabine_invites_enabled: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-[#1A1A1A]">Allow cabine invitations</span>
                <span className="mt-0.5 block text-sm text-gray-500">
                  Cabine owners and tenants can issue guest invitations when enabled.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300"
                checked={form.cabine_paid_invites}
                onChange={(e) => setForm({ ...form, cabine_paid_invites: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-[#1A1A1A]">Cabine paid invitations</span>
                <span className="mt-0.5 block text-sm text-gray-500">
                  Cabines always scan at reception then gate. When enabled, reception confirms payment before gate entry.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300"
                checked={form.chalet_double_scan}
                onChange={(e) => setForm({ ...form, chalet_double_scan: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-[#1A1A1A]">Chalet double scan</span>
                <span className="mt-0.5 block text-sm text-gray-500">
                  When on: reception then gate. When off: one scan at either checkpoint validates.
                </span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Chalet weekday limit"
                type="number"
                min={0}
                value={form.chalet_weekday_limit}
                onChange={(e) => setForm({ ...form, chalet_weekday_limit: e.target.value })}
              />
              <Input
                label="Chalet weekend limit"
                type="number"
                min={0}
                value={form.chalet_weekend_limit}
                onChange={(e) => setForm({ ...form, chalet_weekend_limit: e.target.value })}
              />
              <Input
                label="Cabine weekday limit"
                type="number"
                min={0}
                value={form.cabine_weekday_limit}
                onChange={(e) => setForm({ ...form, cabine_weekday_limit: e.target.value })}
                disabled={!form.cabine_invites_enabled}
              />
              <Input
                label="Cabine weekend limit"
                type="number"
                min={0}
                value={form.cabine_weekend_limit}
                onChange={(e) => setForm({ ...form, cabine_weekend_limit: e.target.value })}
                disabled={!form.cabine_invites_enabled}
              />
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-700">Weekend days</legend>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((label, day) => {
                  const active = form.weekend_days.includes(day)
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        setForm({ ...form, weekend_days: toggleDay(form.weekend_days, day) })
                      }
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

            {/* Branding */}
            <div className="space-y-4 rounded-2xl border border-[#ECECEC] bg-[#FAFAFA] p-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">Branding</p>

              <div>
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Logo</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                  className="block text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-[#1A1A1A] file:shadow-sm hover:file:bg-gray-50"
                />
              </div>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Primary color</span>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.primary_color}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    className="h-10 w-14 cursor-pointer rounded-lg border border-[#ECECEC] bg-white"
                  />
                  <input
                    type="text"
                    value={form.primary_color}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    className="w-32 rounded-xl border border-[#ECECEC] bg-white px-3 py-2.5 font-mono text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  />
                </div>
              </label>

              {/* Live preview */}
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-400">
                  Dashboard preview
                </span>
                <div className="overflow-hidden rounded-xl border border-[#ECECEC]">
                  <div className="flex items-center gap-2 border-b border-[#ECECEC] bg-white px-4 py-3">
                    {logoPreview ? (
                      <img
                        src={logoPreview}
                        alt="Logo preview"
                        className="h-7 w-auto max-w-[120px] object-contain"
                      />
                    ) : (
                      <span
                        className="text-xs font-semibold uppercase tracking-widest"
                        style={{ color: form.primary_color }}
                      >
                        {form.name || 'Resort'}
                      </span>
                    )}
                  </div>
                  <div className="space-y-3 bg-[#FAFAFA] px-4 py-4">
                    <div
                      className="inline-flex rounded-lg px-2.5 py-1 text-xs font-medium"
                      style={{
                        color: form.primary_color,
                        backgroundColor: `${form.primary_color}14`,
                      }}
                    >
                      Active tab
                    </div>
                    <div>
                      <span
                        className="inline-flex rounded-xl px-4 py-2 text-sm font-medium text-white"
                        style={{ backgroundColor: form.primary_color }}
                      >
                        Primary button
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {/* Delete confirmation modal */}
      {deleteTarget ? (
        <Modal
          title="Delete resort"
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, delete everything'}
              </Button>
            </>
          }
        >
          <p className="text-gray-600">
            Delete <span className="font-semibold text-[#1A1A1A]">{deleteTarget.name}</span>?
          </p>
          <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            This will permanently delete the resort and cascade-delete{' '}
            <strong>all its units, rentals, invitations, staff, and announcements</strong>. This
            cannot be undone.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
