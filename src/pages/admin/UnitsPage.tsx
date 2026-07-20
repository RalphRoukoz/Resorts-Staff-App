import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { PERMISSIONS } from '../../lib/permissions'
import { formatAllowanceCell, parseAllowanceBucket } from '../../lib/allowance'
import { formatPersonName } from '../../lib/names'
import { resortLimitsForAssetType } from '../../lib/resortLimits'
import { PAGE_SIZE, totalPages } from '../../lib/pagination'
import { displayPhoneList, isValidPhone, parsePhoneList, PHONE_ERROR, normalizePhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { Asset, AssetInviteAllowance, AssetType, InviteAllowanceBucket, Resort } from '../../types/database'

interface UnitForm {
  label: string
  owner_first_name: string
  owner_last_name: string
  owner_phones_text: string
  asset_type: AssetType
  allow_multiple_logins: boolean
}

const emptyForm: UnitForm = {
  label: '',
  owner_first_name: '',
  owner_last_name: '',
  owner_phones_text: '',
  asset_type: 'chalet',
  allow_multiple_logins: false,
}

function unitSupportsBonusInvites(unit: Asset, resort: Resort | null): boolean {
  if (unit.asset_type === 'chalet') return true
  if (unit.asset_type === 'cabine') {
    return Boolean(resort?.cabine_invites_enabled && resort?.cabine_limit_invites)
  }
  return false
}

function allowanceCell(
  allowance: AssetInviteAllowance | undefined,
  bucket: InviteAllowanceBucket | undefined,
  noDataLabel: string,
  unlimitedLabel: string,
): string {
  if (allowance?.unlimited) return unlimitedLabel
  return formatAllowanceCell(bucket, noDataLabel, unlimitedLabel)
}

function AllowanceValue({
  loading,
  allowance,
  bucket,
  noDataLabel,
  unlimitedLabel,
}: {
  loading: boolean
  allowance: AssetInviteAllowance | undefined
  bucket: InviteAllowanceBucket | undefined
  noDataLabel: string
  unlimitedLabel: string
}) {
  if (loading) {
    return <span className="inline-block h-4 w-12 animate-pulse rounded bg-gray-200" aria-hidden />
  }
  return <>{allowanceCell(allowance, bucket, noDataLabel, unlimitedLabel)}</>
}

function mapAllowanceRow(
  id: string,
  row: Record<string, unknown> | null | undefined,
): [string, AssetInviteAllowance] | null {
  if (!row || row.error) return null

  const weekday = parseAllowanceBucket(row.weekday)
  const weekend = parseAllowanceBucket(row.weekend)
  const unlimited = row.unlimited === true
  if (!weekday && !weekend && !unlimited) return null

  return [
    id,
    {
      month: String(row.month ?? ''),
      unlimited,
      period_label: row.period_label ? String(row.period_label) : undefined,
      period_mode: row.period_mode as AssetInviteAllowance['period_mode'],
      weekday: weekday ?? { base: 0, bonus: 0, total: 0, used: 0, remaining: 0 },
      weekend: weekend ?? { base: 0, bonus: 0, total: 0, used: 0, remaining: 0 },
    },
  ]
}

export function UnitsPage() {
  const { t } = useTranslation()
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
  const [allowancesLoading, setAllowancesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Asset | null>(null)
  const [form, setForm] = useState<UnitForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [bonusUnit, setBonusUnit] = useState<Asset | null>(null)
  const [bonusMode, setBonusMode] = useState<'add' | 'remove'>('add')
  const [weekdayAdd, setWeekdayAdd] = useState('1')
  const [weekendAdd, setWeekendAdd] = useState('0')
  const [bonusError, setBonusError] = useState<string | null>(null)
  const [bonusSaving, setBonusSaving] = useState(false)

  const pages = totalPages(total)

  const loadAllowances = useCallback(async (assetIds: string[]) => {
    if (assetIds.length === 0) {
      setAllowances({})
      setAllowancesLoading(false)
      return
    }

    setAllowancesLoading(true)
    setAllowances({})

    const applyRows = (rows: Array<[string, AssetInviteAllowance] | null>) => {
      setAllowances(Object.fromEntries(rows.filter((entry): entry is [string, AssetInviteAllowance] => entry !== null)))
    }

    try {
      const { data, error: rpcError } = await supabase.rpc('asset_invite_allowances_batch', {
        p_asset_ids: assetIds,
      })

      const batchPayload = data as Record<string, unknown> | null
      if (!rpcError && batchPayload && !batchPayload.error) {
        const batch = batchPayload as Record<string, Record<string, unknown>>
        const entries = assetIds.map((id) => mapAllowanceRow(id, batch[id]))
        if (entries.some((entry) => entry !== null)) {
          applyRows(entries)
          return
        }
      }

      const fallback = await Promise.all(
        assetIds.map(async (id) => {
          const { data: row, error } = await supabase.rpc('asset_invite_allowance', { p_asset: id })
          if (error || !row) return null
          return mapAllowanceRow(id, row as Record<string, unknown>)
        }),
      )

      if (fallback.some((entry) => entry !== null)) {
        applyRows(fallback)
        return
      }

      if (rpcError) {
        console.error('Failed to load invitation allowances', rpcError.message)
      } else if (batchPayload?.error) {
        console.error('Failed to load invitation allowances', batchPayload.error)
      }

      setAllowances({})
    } finally {
      setAllowancesLoading(false)
    }
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
      const filters = [
        `label.ilike.%${trimmed}%`,
        `owner_first_name.ilike.%${trimmed}%`,
        `owner_last_name.ilike.%${trimmed}%`,
      ]
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
      setAllowances({})
    } else {
      const rows = (data ?? []) as Asset[]
      setUnits(rows)
      setTotal(count ?? 0)
      await loadAllowances(rows.map((r) => r.id))
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
      owner_first_name: unit.owner_first_name ?? '',
      owner_last_name: unit.owner_last_name ?? '',
      owner_phones_text: (unit.owner_phones ?? []).join('\n'),
      asset_type: unit.asset_type,
      allow_multiple_logins: unit.allow_multiple_logins ?? false,
    })
    setFormError(null)
    setModalOpen(true)
  }

  function openBonus(unit: Asset, mode: 'add' | 'remove' = 'add') {
    setBonusUnit(unit)
    setBonusMode(mode)
    setWeekdayAdd(mode === 'add' ? '1' : '0')
    setWeekendAdd('0')
    setBonusError(null)
  }

  async function handleSave() {
    if (!resortId) return
    if (!form.label.trim()) {
      setFormError('Label is required')
      return
    }
    if (!editing && (!form.owner_first_name.trim() || !form.owner_last_name.trim())) {
      setFormError('Owner first and last name are required')
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

    const defaults = resort
      ? resortLimitsForAssetType(resort, form.asset_type)
      : { weekday_limit: 0, weekend_limit: 0 }

    const payload = {
      label: form.label.trim(),
      owner_first_name: form.owner_first_name.trim() || null,
      owner_last_name: form.owner_last_name.trim() || null,
      owner_phones: ownerPhones,
      asset_type: form.asset_type,
      allow_multiple_logins: form.allow_multiple_logins,
      weekday_limit: editing?.weekday_limit ?? defaults.weekday_limit,
      weekend_limit: editing?.weekend_limit ?? defaults.weekend_limit,
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
    const wd = Math.max(0, Math.floor(Number(weekdayAdd) || 0))
    const we = Math.max(0, Math.floor(Number(weekendAdd) || 0))
    if (wd === 0 && we === 0) {
      setBonusError(
        bonusMode === 'remove'
          ? 'Enter at least one amount to remove'
          : 'Enter at least one positive bonus amount',
      )
      return
    }

    setBonusSaving(true)
    setBonusError(null)

    const { error: rpcError } =
      bonusMode === 'remove'
        ? await supabase.rpc('remove_asset_invite_bonus', {
            p_asset: bonusUnit.id,
            p_weekday_remove: wd,
            p_weekend_remove: we,
          })
        : await supabase.rpc('grant_asset_invite_bonus', {
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

      {loading && units.length === 0 ? (
        <Spinner label={t('units.loading')} />
      ) : (
        <div className={loading ? 'relative' : undefined}>
          {loading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/70">
              <Spinner label={t('units.loading')} />
            </div>
          ) : null}
          <p className="mb-2 text-xs text-gray-400">
            Invitations remaining / total for {monthLabel} (weekday · weekend)
          </p>
          <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">{t('units.owner')}</th>
                  <th className="px-4 py-3 font-medium">{t('units.ownerPhones')}</th>
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
                      <td className="px-4 py-3 text-gray-600">
                        {formatPersonName(unit.owner_first_name, unit.owner_last_name, t('units.noOwnerName'))}
                      </td>
                      <td className="tnum px-4 py-3 text-gray-600">{displayPhoneList(unit.owner_phones)}</td>
                      <td className="tnum px-4 py-3 text-gray-600">
                        <AllowanceValue
                          loading={allowancesLoading}
                          allowance={allowance}
                          bucket={allowance?.weekday}
                          noDataLabel={t('units.noData')}
                          unlimitedLabel={t('units.unlimited')}
                        />
                        {!allowancesLoading && allowance?.weekday?.bonus ? (
                          <span className="ml-1 text-xs text-amber-600">+{allowance.weekday.bonus} bonus</span>
                        ) : null}
                      </td>
                      <td className="tnum px-4 py-3 text-gray-600">
                        <AllowanceValue
                          loading={allowancesLoading}
                          allowance={allowance}
                          bucket={allowance?.weekend}
                          noDataLabel={t('units.noData')}
                          unlimitedLabel={t('units.unlimited')}
                        />
                        {!allowancesLoading && allowance?.weekend?.bonus ? (
                          <span className="ml-1 text-xs text-amber-600">+{allowance.weekend.bonus} bonus</span>
                        ) : null}
                      </td>
                      {canManageUnits || canGrantBonus ? (
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {canGrantBonus && unitSupportsBonusInvites(unit, resort) ? (
                              <>
                                <Button variant="secondary" onClick={() => openBonus(unit, 'add')}>
                                  {t('units.addInvites')}
                                </Button>
                                <Button variant="secondary" onClick={() => openBonus(unit, 'remove')}>
                                  {t('units.removeInvites')}
                                </Button>
                              </>
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
                      colSpan={canManageUnits || canGrantBonus ? 7 : 6}
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
        </div>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t('units.ownerFirstName')}
                value={form.owner_first_name}
                onChange={(event) => setForm({ ...form, owner_first_name: event.target.value })}
              />
              <Input
                label={t('units.ownerLastName')}
                value={form.owner_last_name}
                onChange={(event) => setForm({ ...form, owner_last_name: event.target.value })}
              />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">{t('units.ownerPhones')}</span>
              <textarea
                className="min-h-28 w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] placeholder:text-gray-400 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                value={form.owner_phones_text}
                onChange={(event) => setForm({ ...form, owner_phones_text: event.target.value })}
                placeholder={'One phone per line\n70123456\n+96170123457'}
              />
            </label>
            <p className="text-sm text-gray-500">Add every owner phone that should access this unit. One number per line.</p>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300"
                checked={form.allow_multiple_logins}
                onChange={(e) => setForm({ ...form, allow_multiple_logins: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-[#1A1A1A]">{t('units.allowMultipleLogins')}</span>
                <span className="mt-0.5 block text-sm text-gray-500">{t('units.allowMultipleLoginsHint')}</span>
              </span>
            </label>
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
          title={`${bonusMode === 'remove' ? 'Remove bonus invites' : 'Add bonus invites'} — ${bonusUnit.label}`}
          onClose={() => setBonusUnit(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setBonusUnit(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleGrantBonus()} disabled={bonusSaving}>
                {bonusSaving
                  ? bonusMode === 'remove'
                    ? 'Removing…'
                    : 'Adding…'
                  : bonusMode === 'remove'
                    ? 'Remove from this month'
                    : 'Add to this month'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              {bonusMode === 'remove'
                ? 'Removes bonus invitations for the current calendar month only. Amounts cannot go below zero.'
                : 'Bonuses stack for the current calendar month and reset automatically next month. Base allowance stays the resort default.'}
            </p>
            {bonusMode === 'remove' && allowances[bonusUnit.id] ? (
              <p className="text-xs text-gray-500">
                Current bonus: {allowances[bonusUnit.id].weekday.bonus ?? 0} weekday ·{' '}
                {allowances[bonusUnit.id].weekend.bonus ?? 0} weekend
              </p>
            ) : null}
            <Input
              label={bonusMode === 'remove' ? 'Weekday invitations to remove' : 'Extra weekday invitations'}
              type="number"
              min={0}
              value={weekdayAdd}
              onChange={(e) => setWeekdayAdd(e.target.value.replace(/[^\d]/g, ''))}
            />
            <Input
              label={bonusMode === 'remove' ? 'Weekend invitations to remove' : 'Extra weekend invitations'}
              type="number"
              min={0}
              value={weekendAdd}
              onChange={(e) => setWeekendAdd(e.target.value.replace(/[^\d]/g, ''))}
            />
            {bonusError ? <p className="text-sm text-red-600">{bonusError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
