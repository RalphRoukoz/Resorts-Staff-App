import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { PERMISSIONS } from '../../lib/permissions'
import { PAGE_SIZE, totalPages } from '../../lib/pagination'
import { displayPhoneList, isValidPhone, parsePhoneList, PHONE_ERROR, normalizePhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { Asset, AssetInviteAllowance, AssetType } from '../../types/database'

interface UnitForm {
  label: string
  owner_phones_text: string
  asset_type: AssetType
}

const emptyForm: UnitForm = {
  label: '',
  owner_phones_text: '',
  asset_type: 'chalet',
}

function allowanceCell(bucket: { total: number; remaining: number } | undefined): string {
  if (!bucket) return '—'
  return `${bucket.remaining} / ${bucket.total}`
}

export function UnitsPage() {
  const { resortId, resort, hasPermission } = useAuth()
  const canManageUnits = hasPermission(PERMISSIONS.UNITS_WRITE)
  const canGrantBonus = hasPermission(PERMISSIONS.INVITATIONS_BONUS)

  const [units, setUnits] = useState<Asset[]>([])
  const [allowances, setAllowances] = useState<Record<string, AssetInviteAllowance>>({})
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | AssetType>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Asset | null>(null)
  const [form, setForm] = useState<UnitForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [bonusUnit, setBonusUnit] = useState<Asset | null>(null)
  const [weekdayAdd, setWeekdayAdd] = useState('1')
  const [weekendAdd, setWeekendAdd] = useState('0')
  const [bonusError, setBonusError] = useState<string | null>(null)
  const [bonusSaving, setBonusSaving] = useState(false)

  const pages = totalPages(total)

  const loadAllowances = useCallback(async (assetIds: string[]) => {
    const entries = await Promise.all(
      assetIds.map(async (id) => {
        const { data, error: rpcError } = await supabase.rpc('asset_invite_allowance', { p_asset: id })
        if (rpcError || !data || data.error) return [id, null] as const
        return [id, data as AssetInviteAllowance] as const
      }),
    )
    setAllowances(Object.fromEntries(entries.filter(([, v]) => v != null) as [string, AssetInviteAllowance][]))
  }, [])

  const loadUnits = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('assets')
      .select('*', { count: 'exact' })
      .eq('resort_id', resortId)
      .order('label')
      .range(from, to)

    const trimmed = search.trim()
    if (trimmed) {
      const filters = [`label.ilike.%${trimmed}%`, `owner_phone.ilike.%${trimmed}%`]
      const normalized = normalizePhone(trimmed)
      if (normalized) filters.push(`owner_phones.cs.{${normalized}}`)
      query = query.or(filters.join(','))
    }
    if (typeFilter !== 'all') {
      query = query.eq('asset_type', typeFilter)
    }

    const { data, error: fetchError, count } = await query

    if (fetchError) {
      setError(fetchError.message)
      setUnits([])
    } else {
      const rows = (data ?? []) as Asset[]
      setUnits(rows)
      setTotal(count ?? 0)
      void loadAllowances(rows.map((r) => r.id))
    }
    setLoading(false)
  }, [resortId, page, search, typeFilter, loadAllowances])

  useEffect(() => {
    void loadUnits()
  }, [loadUnits])

  useEffect(() => {
    setPage(1)
  }, [search, typeFilter])

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
      owner_phones_text: (unit.owner_phones?.length ? unit.owner_phones : [unit.owner_phone]).join('\n'),
      asset_type: unit.asset_type,
    })
    setFormError(null)
    setModalOpen(true)
  }

  function openBonus(unit: Asset) {
    setBonusUnit(unit)
    setWeekdayAdd('1')
    setWeekendAdd('0')
    setBonusError(null)
  }

  async function handleSave() {
    if (!resortId) return
    if (!form.label.trim()) {
      setFormError('Label is required')
      return
    }
    const rawOwnerPhones = form.owner_phones_text
      .split(/[\n,;]/)
      .map((value) => value.trim())
      .filter(Boolean)
    const ownerPhones = parsePhoneList(form.owner_phones_text)
    if (ownerPhones.length === 0) {
      setFormError('Add at least one owner phone')
      return
    }
    if (rawOwnerPhones.some((phone) => !isValidPhone(phone))) {
      setFormError(PHONE_ERROR)
      return
    }

    setSaving(true)
    setFormError(null)

    const payload = {
      label: form.label.trim(),
      owner_phone: ownerPhones[0],
      owner_phones: ownerPhones,
      asset_type: form.asset_type,
      weekday_limit: null,
      weekend_limit: null,
    }

    if (editing) {
      const { error: updateError } = await supabase.from('assets').update(payload).eq('id', editing.id)
      if (updateError) setFormError(updateError.message)
      else {
        setModalOpen(false)
        await loadUnits()
      }
    } else {
      const { error: insertError } = await supabase.from('assets').insert({ ...payload, resort_id: resortId })
      if (insertError) setFormError(insertError.message)
      else {
        setModalOpen(false)
        await loadUnits()
      }
    }

    setSaving(false)
  }

  async function handleGrantBonus() {
    if (!bonusUnit) return
    const wd = Number(weekdayAdd) || 0
    const we = Number(weekendAdd) || 0
    if (wd < 0 || we < 0 || (wd === 0 && we === 0)) {
      setBonusError('Enter at least one positive bonus amount')
      return
    }

    setBonusSaving(true)
    setBonusError(null)

    const { error: rpcError } = await supabase.rpc('grant_asset_invite_bonus', {
      p_asset: bonusUnit.id,
      p_weekday_add: wd,
      p_weekend_add: we,
    })

    if (rpcError) {
      setBonusError(rpcError.message)
    } else {
      setBonusUnit(null)
      await loadUnits()
    }
    setBonusSaving(false)
  }

  async function handleDelete(unit: Asset) {
    if (!confirm(`Delete ${unit.asset_type} "${unit.label}"?`)) return

    const { error: deleteError } = await supabase.from('assets').delete().eq('id', unit.id)
    if (deleteError) setError(deleteError.message)
    else await loadUnits()
  }

  const monthLabel = allowances[units[0]?.id ?? '']?.month ?? 'this month'

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Chalets &amp; Cabines</h2>
          <p className="mt-1 text-sm text-gray-500">
            {canManageUnits
              ? 'Manage units. Invite limits use resort defaults and reset each month.'
              : 'View units and monthly invitation allowance.'}
          </p>
        </div>
        {canManageUnits ? <Button onClick={openCreate}>Add unit</Button> : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Label or phone…"
          />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Type</span>
          <select
            className="rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | AssetType)}
          >
            <option value="all">All types</option>
            <option value="chalet">Chalet</option>
            <option value="cabine">Cabine</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {loading ? (
        <Spinner label="Loading units…" />
      ) : (
        <>
          <p className="mb-2 text-xs text-gray-400">
            Invitations remaining / total for {monthLabel} (weekday · weekend)
          </p>
          <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Owner phones</th>
                  <th className="px-4 py-3 font-medium">Weekday</th>
                  <th className="px-4 py-3 font-medium">Weekend</th>
                  {canManageUnits || canGrantBonus ? (
                    <th className="px-4 py-3 font-medium">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {units.map((unit) => {
                  const allowance = allowances[unit.id]
                  return (
                    <tr key={unit.id} className="transition hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-[#1A1A1A]">{unit.label}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${
                            unit.asset_type === 'chalet'
                              ? 'bg-[#E1F3FE] text-[#1F6C9F]'
                              : 'bg-[#FBF3DB] text-[#956400]'
                          }`}
                        >
                          {unit.asset_type}
                        </span>
                      </td>
                      <td className="tnum px-4 py-3 text-gray-600">{displayPhoneList(unit.owner_phones)}</td>
                      <td className="tnum px-4 py-3 text-gray-600">
                        {allowanceCell(allowance?.weekday)}
                        {allowance?.weekday?.bonus ? (
                          <span className="ml-1 text-xs text-amber-600">+{allowance.weekday.bonus} bonus</span>
                        ) : null}
                      </td>
                      <td className="tnum px-4 py-3 text-gray-600">
                        {allowanceCell(allowance?.weekend)}
                        {allowance?.weekend?.bonus ? (
                          <span className="ml-1 text-xs text-amber-600">+{allowance.weekend.bonus} bonus</span>
                        ) : null}
                      </td>
                      {canManageUnits || canGrantBonus ? (
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {canGrantBonus && unit.asset_type === 'chalet' ? (
                              <Button variant="secondary" onClick={() => openBonus(unit)}>
                                Add invites
                              </Button>
                            ) : null}
                            {canManageUnits ? (
                              <>
                                <Button variant="secondary" onClick={() => openEdit(unit)}>
                                  Edit
                                </Button>
                                <Button variant="danger" onClick={() => void handleDelete(unit)}>
                                  Delete
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
                {units.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canManageUnits || canGrantBonus ? 6 : 5}
                      className="px-4 py-10 text-center text-gray-400"
                    >
                      No units match your filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
            <p>
              {total === 0 ? 'No units' : `${total.toLocaleString()} unit${total === 1 ? '' : 's'}`}
              {total > 0 ? ` · page ${page} of ${pages}` : ''}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {modalOpen && canManageUnits ? (
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
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Type</span>
              <select
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                value={form.asset_type}
                onChange={(event) => setForm({ ...form, asset_type: event.target.value as AssetType })}
              >
                <option value="chalet">Chalet</option>
                <option value="cabine">Cabine</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Owner phones</span>
              <textarea
                className="min-h-28 w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] placeholder:text-gray-400 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                value={form.owner_phones_text}
                onChange={(event) => setForm({ ...form, owner_phones_text: event.target.value })}
                placeholder={'One phone per line\n79400020\n+96179400021'}
              />
            </label>
            <p className="text-sm text-gray-500">The first number becomes the primary phone for compatibility with existing flows.</p>
            <p className="text-sm text-gray-500">
              Monthly invite limits come from resort defaults
              {resort ? ` (${resort.chalet_weekday_limit} weekday / ${resort.chalet_weekend_limit} weekend for chalets).` : '.'}
              Use &quot;Add invites&quot; to grant extra invitations for the current month only.
            </p>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {bonusUnit && canGrantBonus ? (
        <Modal
          title={`Add bonus invites — ${bonusUnit.label}`}
          onClose={() => setBonusUnit(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setBonusUnit(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleGrantBonus()} disabled={bonusSaving}>
                {bonusSaving ? 'Adding…' : 'Add to this month'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Bonuses stack for the current calendar month and reset automatically next month. Base allowance
              stays the resort default.
            </p>
            <Input
              label="Extra weekday invitations"
              type="number"
              min={0}
              value={weekdayAdd}
              onChange={(e) => setWeekdayAdd(e.target.value)}
            />
            <Input
              label="Extra weekend invitations"
              type="number"
              min={0}
              value={weekendAdd}
              onChange={(e) => setWeekendAdd(e.target.value)}
            />
            {bonusError ? <p className="text-sm text-red-600">{bonusError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
