import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { displayPhone, formatPhoneError, isValidPhone, normalizePhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { Asset, AssetType, Resort } from '../../types/database'

interface UnitForm {
  label: string
  owner_phone: string
  asset_type: AssetType
  weekday_limit: string
  weekend_limit: string
}

const emptyForm: UnitForm = {
  label: '',
  owner_phone: '',
  asset_type: 'chalet',
  weekday_limit: '',
  weekend_limit: '',
}

function resortDefault(resort: Resort | null, type: AssetType, kind: 'weekday' | 'weekend'): number | null {
  if (!resort) return null
  if (type === 'chalet') {
    return kind === 'weekday' ? resort.chalet_weekday_limit : resort.chalet_weekend_limit
  }
  return kind === 'weekday' ? resort.cabine_weekday_limit : resort.cabine_weekend_limit
}

function limitLabel(
  value: number | null,
  resort: Resort | null,
  type: AssetType,
  kind: 'weekday' | 'weekend',
): string {
  if (value != null) return String(value)
  const def = resortDefault(resort, type, kind)
  return def != null ? `default (${def})` : 'default'
}

export function UnitsPage() {
  const { resortId, resort } = useAuth()
  const [units, setUnits] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Asset | null>(null)
  const [form, setForm] = useState<UnitForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadUnits = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('assets')
      .select('*')
      .eq('resort_id', resortId)
      .order('label')

    if (fetchError) setError(fetchError.message)
    else setUnits((data ?? []) as Asset[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadUnits()
  }, [loadUnits])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(unit: Asset) {
    setEditing(unit)
    setForm({
      label: unit.label,
      owner_phone: unit.owner_phone,
      asset_type: unit.asset_type,
      weekday_limit: unit.weekday_limit?.toString() ?? '',
      weekend_limit: unit.weekend_limit?.toString() ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!resortId) return
    if (!form.label.trim()) {
      setFormError('Label is required')
      return
    }
    if (!isValidPhone(form.owner_phone)) {
      setFormError(formatPhoneError())
      return
    }

    setSaving(true)
    setFormError(null)

    const payload = {
      label: form.label.trim(),
      owner_phone: normalizePhone(form.owner_phone),
      asset_type: form.asset_type,
      weekday_limit: form.weekday_limit ? Number(form.weekday_limit) : null,
      weekend_limit: form.weekend_limit ? Number(form.weekend_limit) : null,
    }

    if (editing) {
      const { error: updateError } = await supabase
        .from('assets')
        .update(payload)
        .eq('id', editing.id)

      if (updateError) setFormError(updateError.message)
      else {
        setModalOpen(false)
        await loadUnits()
      }
    } else {
      const { error: insertError } = await supabase.from('assets').insert({
        ...payload,
        resort_id: resortId,
      })

      if (insertError) setFormError(insertError.message)
      else {
        setModalOpen(false)
        await loadUnits()
      }
    }

    setSaving(false)
  }

  async function handleDelete(unit: Asset) {
    if (!confirm(`Delete ${unit.asset_type} "${unit.label}"?`)) return

    const { error: deleteError } = await supabase.from('assets').delete().eq('id', unit.id)
    if (deleteError) setError(deleteError.message)
    else await loadUnits()
  }

  if (loading) return <Spinner label="Loading units…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">Chalets &amp; Cabines</h2>
          <p className="mt-1 text-sm text-slate-400">Manage units, types, and invite limits.</p>
        </div>
        <Button onClick={openCreate}>Add unit</Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Label</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Owner phone</th>
              <th className="px-4 py-3 font-medium">Weekday limit</th>
              <th className="px-4 py-3 font-medium">Weekend limit</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {units.map((unit) => (
              <tr key={unit.id} className="bg-slate-950/50">
                <td className="px-4 py-3 font-medium text-white">{unit.label}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                      unit.asset_type === 'chalet'
                        ? 'bg-sky-600/20 text-sky-300'
                        : 'bg-amber-600/20 text-amber-300'
                    }`}
                  >
                    {unit.asset_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">{displayPhone(unit.owner_phone)}</td>
                <td className="px-4 py-3 text-slate-300">
                  {limitLabel(unit.weekday_limit, resort, unit.asset_type, 'weekday')}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {limitLabel(unit.weekend_limit, resort, unit.asset_type, 'weekend')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => openEdit(unit)}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => void handleDelete(unit)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {units.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No units yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <Modal
          title={editing ? 'Edit unit' : 'Add unit'}
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
          <div className="space-y-4">
            <Input
              label="Label"
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Type</span>
              <select
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-slate-100"
                value={form.asset_type}
                onChange={(event) =>
                  setForm({ ...form, asset_type: event.target.value as AssetType })
                }
              >
                <option value="chalet">Chalet</option>
                <option value="cabine">Cabine</option>
              </select>
            </label>
            <Input
              label="Owner phone"
              value={form.owner_phone}
              onChange={(event) => setForm({ ...form, owner_phone: event.target.value })}
              placeholder="79400020 or +96179400020"
            />
            <Input
              label="Weekday limit (blank = resort default)"
              type="number"
              min={0}
              value={form.weekday_limit}
              onChange={(event) => setForm({ ...form, weekday_limit: event.target.value })}
            />
            <Input
              label="Weekend limit (blank = resort default)"
              type="number"
              min={0}
              value={form.weekend_limit}
              onChange={(event) => setForm({ ...form, weekend_limit: event.target.value })}
            />
            {formError ? <p className="text-sm text-rose-400">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
