import { useCallback, useEffect, useRef, useState } from 'react'
import { UnitSearchSelect } from '../../components/UnitSearchSelect'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDate, todayISO } from '../../lib/dates'
import { formatPersonName } from '../../lib/names'
import { displayPhone, PHONE_ERROR, isValidPhone, normalizePhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { TenancyWithAsset } from '../../types/database'

interface RentalForm {
  asset_id: string
  tenant_first_name: string
  tenant_last_name: string
  tenant_phone: string
  starts_on: string
  ends_on: string
}

const emptyForm: RentalForm = {
  asset_id: '',
  tenant_first_name: '',
  tenant_last_name: '',
  tenant_phone: '',
  starts_on: todayISO(),
  ends_on: todayISO(),
}

export function RentalsPage() {
  const { resortId, canWrite } = useAuth()
  const [rentals, setRentals] = useState<TenancyWithAsset[]>([])
  const [selectedAssetLabel, setSelectedAssetLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<RentalForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const tenantFirstNameRef = useRef<HTMLInputElement>(null)
  const tenantPhoneRef = useRef<HTMLInputElement>(null)

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const today = todayISO()

    const { data, error: fetchError } = await supabase
      .from('tenancies')
      .select('*, assets!inner(label, resort_id)')
      .eq('assets.resort_id', resortId)
      .gte('ends_on', today)
      .order('starts_on')

    if (fetchError) setError(fetchError.message)
    else setRentals((data ?? []) as TenancyWithAsset[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function openCreate() {
    setForm({ ...emptyForm })
    setSelectedAssetLabel('')
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.asset_id) {
      setFormError('Select a chalet')
      return
    }
    if (!form.tenant_first_name.trim() || !form.tenant_last_name.trim()) {
      setFormError('Tenant first and last name are required')
      return
    }
    if (!isValidPhone(form.tenant_phone)) {
      setFormError(PHONE_ERROR)
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
      tenant_first_name: form.tenant_first_name.trim(),
      tenant_last_name: form.tenant_last_name.trim(),
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
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Rentals</h2>
          <p className="mt-1 text-sm text-gray-500">
            {canWrite
              ? 'Current and upcoming tenancies. Control transfers automatically on create.'
              : 'Current and upcoming tenancies.'}
          </p>
        </div>
        {canWrite ? <Button onClick={openCreate}>Create rental</Button> : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Chalet</th>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Tenant phone</th>
              <th className="px-4 py-3 font-medium">Start</th>
              <th className="px-4 py-3 font-medium">End</th>
              {canWrite ? <th className="px-4 py-3 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rentals.map((rental) => (
              <tr key={rental.id} className="transition hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-[#1A1A1A]">{rental.assets.label}</td>
                <td className="px-4 py-3 text-gray-600">
                  {formatPersonName(rental.tenant_first_name, rental.tenant_last_name)}
                </td>
                <td className="px-4 py-3 text-gray-600">{displayPhone(rental.tenant_phone)}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(rental.starts_on)}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(rental.ends_on)}</td>
                {canWrite ? (
                  <td className="px-4 py-3">
                    <Button variant="danger" onClick={() => void handleDelete(rental)}>
                      Delete
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
            {rentals.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 6 : 5} className="px-4 py-10 text-center text-gray-400">
                  No current or upcoming rentals.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {modalOpen && canWrite && resortId ? (
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
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Chalet / cabine</span>
              <UnitSearchSelect
                resortId={resortId}
                value={form.asset_id}
                selectedLabel={selectedAssetLabel}
                onChange={(id, opt) => {
                  setForm({ ...form, asset_id: id })
                  setSelectedAssetLabel(opt ? `${opt.label} (${opt.asset_type})` : '')
                }}
                onSelect={() => {
                  setTimeout(() => tenantFirstNameRef.current?.focus(), 0)
                }}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                ref={tenantFirstNameRef}
                label="Tenant first name"
                value={form.tenant_first_name}
                onChange={(event) => setForm({ ...form, tenant_first_name: event.target.value })}
              />
              <Input
                label="Tenant last name"
                value={form.tenant_last_name}
                onChange={(event) => setForm({ ...form, tenant_last_name: event.target.value })}
              />
            </div>
            <Input
              ref={tenantPhoneRef}
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
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
