import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDate, todayISO } from '../../lib/dates'
import { displayPhone, formatPhoneError, isValidPhone, normalizePhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { Asset, TenancyWithAsset } from '../../types/database'

interface RentalForm {
  asset_id: string
  tenant_phone: string
  starts_on: string
  ends_on: string
}

const emptyForm: RentalForm = {
  asset_id: '',
  tenant_phone: '',
  starts_on: todayISO(),
  ends_on: todayISO(),
}

export function RentalsPage() {
  const { resortId } = useAuth()
  const [rentals, setRentals] = useState<TenancyWithAsset[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<RentalForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const today = todayISO()

    const [rentalsResult, assetsResult] = await Promise.all([
      supabase
        .from('tenancies')
        .select('*, assets!inner(label, resort_id)')
        .eq('assets.resort_id', resortId)
        .gte('ends_on', today)
        .order('starts_on'),
      supabase.from('assets').select('*').eq('resort_id', resortId).order('label'),
    ])

    if (rentalsResult.error) setError(rentalsResult.error.message)
    else setRentals((rentalsResult.data ?? []) as TenancyWithAsset[])

    if (assetsResult.data) setAssets(assetsResult.data as Asset[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function openCreate() {
    setForm({
      ...emptyForm,
      asset_id: assets[0]?.id ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.asset_id) {
      setFormError('Select a chalet')
      return
    }
    if (!isValidPhone(form.tenant_phone)) {
      setFormError(formatPhoneError())
      return
    }
    if (form.ends_on < form.starts_on) {
      setFormError('End date must be on or after start date')
      return
    }

    setSaving(true)
    setFormError(null)

    const { error: insertError } = await supabase.from('tenancies').insert({
      asset_id: form.asset_id,
      tenant_phone: normalizePhone(form.tenant_phone),
      starts_on: form.starts_on,
      ends_on: form.ends_on,
    })

    if (insertError) setFormError(insertError.message)
    else {
      setModalOpen(false)
      await loadData()
    }
    setSaving(false)
  }

  async function handleDelete(rental: TenancyWithAsset) {
    if (!confirm(`Delete rental for ${rental.assets.label}?`)) return

    const { error: deleteError } = await supabase.from('tenancies').delete().eq('id', rental.id)
    if (deleteError) setError(deleteError.message)
    else await loadData()
  }

  if (loading) return <Spinner label="Loading rentals…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">Rentals</h2>
          <p className="mt-1 text-sm text-slate-400">
            Current and upcoming tenancies. Control transfers automatically on create.
          </p>
        </div>
        <Button onClick={openCreate} disabled={assets.length === 0}>
          Create rental
        </Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Chalet</th>
              <th className="px-4 py-3 font-medium">Tenant phone</th>
              <th className="px-4 py-3 font-medium">Start</th>
              <th className="px-4 py-3 font-medium">End</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rentals.map((rental) => (
              <tr key={rental.id} className="bg-slate-950/50">
                <td className="px-4 py-3 font-medium text-white">{rental.assets.label}</td>
                <td className="px-4 py-3 text-slate-300">{displayPhone(rental.tenant_phone)}</td>
                <td className="px-4 py-3 text-slate-300">{formatDate(rental.starts_on)}</td>
                <td className="px-4 py-3 text-slate-300">{formatDate(rental.ends_on)}</td>
                <td className="px-4 py-3">
                  <Button variant="danger" onClick={() => void handleDelete(rental)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
            {rentals.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No current or upcoming rentals.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <Modal
          title="Create rental"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Creating…' : 'Create'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Chalet</span>
              <select
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-slate-100"
                value={form.asset_id}
                onChange={(event) => setForm({ ...form, asset_id: event.target.value })}
              >
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Tenant phone"
              value={form.tenant_phone}
              onChange={(event) => setForm({ ...form, tenant_phone: event.target.value })}
              placeholder="79400020 or +96179400020"
            />
            <Input
              label="Start date"
              type="date"
              value={form.starts_on}
              onChange={(event) => setForm({ ...form, starts_on: event.target.value })}
            />
            <Input
              label="End date"
              type="date"
              value={form.ends_on}
              onChange={(event) => setForm({ ...form, ends_on: event.target.value })}
            />
            {formError ? <p className="text-sm text-rose-400">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
