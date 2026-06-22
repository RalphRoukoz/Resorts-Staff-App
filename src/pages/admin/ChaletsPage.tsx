import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatPhoneError, isValidE164 } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { Asset, Resort } from '../../types/database'

interface AssetForm {
  label: string
  owner_phone: string
  weekday_limit: string
  weekend_limit: string
}

const emptyForm: AssetForm = {
  label: '',
  owner_phone: '',
  weekday_limit: '',
  weekend_limit: '',
}

function limitLabel(value: number | null, resort: Resort | null, type: 'weekday' | 'weekend'): string {
  if (value != null) return String(value)
  if (!resort) return 'default'
  return type === 'weekday'
    ? `default (${resort.default_weekday_limit})`
    : `default (${resort.default_weekend_limit})`
}

export function ChaletsPage() {
  const { resortId, resort } = useAuth()
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Asset | null>(null)
  const [form, setForm] = useState<AssetForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadAssets = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('assets')
      .select('*')
      .eq('resort_id', resortId)
      .order('label')

    if (fetchError) setError(fetchError.message)
    else setAssets((data ?? []) as Asset[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(asset: Asset) {
    setEditing(asset)
    setForm({
      label: asset.label,
      owner_phone: asset.owner_phone,
      weekday_limit: asset.weekday_limit?.toString() ?? '',
      weekend_limit: asset.weekend_limit?.toString() ?? '',
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
    if (!isValidE164(form.owner_phone)) {
      setFormError(formatPhoneError())
      return
    }

    setSaving(true)
    setFormError(null)

    const payload = {
      label: form.label.trim(),
      owner_phone: form.owner_phone.trim(),
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
        await loadAssets()
      }
    } else {
      const { error: insertError } = await supabase.from('assets').insert({
        ...payload,
        resort_id: resortId,
      })

      if (insertError) setFormError(insertError.message)
      else {
        setModalOpen(false)
        await loadAssets()
      }
    }

    setSaving(false)
  }

  async function handleDelete(asset: Asset) {
    if (!confirm(`Delete chalet "${asset.label}"?`)) return

    const { error: deleteError } = await supabase.from('assets').delete().eq('id', asset.id)
    if (deleteError) setError(deleteError.message)
    else await loadAssets()
  }

  if (loading) return <Spinner label="Loading chalets…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">Chalets</h2>
          <p className="mt-1 text-sm text-slate-400">Manage resort assets and invite limits.</p>
        </div>
        <Button onClick={openCreate}>Add chalet</Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Label</th>
              <th className="px-4 py-3 font-medium">Owner phone</th>
              <th className="px-4 py-3 font-medium">Weekday limit</th>
              <th className="px-4 py-3 font-medium">Weekend limit</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {assets.map((asset) => (
              <tr key={asset.id} className="bg-slate-950/50">
                <td className="px-4 py-3 font-medium text-white">{asset.label}</td>
                <td className="px-4 py-3 text-slate-300">{asset.owner_phone}</td>
                <td className="px-4 py-3 text-slate-300">
                  {limitLabel(asset.weekday_limit, resort, 'weekday')}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {limitLabel(asset.weekend_limit, resort, 'weekend')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => openEdit(asset)}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => void handleDelete(asset)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {assets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No chalets yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <Modal
          title={editing ? 'Edit chalet' : 'Add chalet'}
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
            <Input
              label="Owner phone (E.164)"
              value={form.owner_phone}
              onChange={(event) => setForm({ ...form, owner_phone: event.target.value })}
              placeholder="+96170123456"
            />
            <Input
              label="Weekday limit (blank = default)"
              type="number"
              min={0}
              value={form.weekday_limit}
              onChange={(event) => setForm({ ...form, weekday_limit: event.target.value })}
            />
            <Input
              label="Weekend limit (blank = default)"
              type="number"
              min={0}
              value={form.weekend_limit}
              onChange={(event) => setForm({ ...form, weekend_limit: event.target.value })}
            />
            {formError ? (
              <p className="text-sm text-rose-400">{formError}</p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
