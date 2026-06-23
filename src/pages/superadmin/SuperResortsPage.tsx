import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { DAY_LABELS } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { ResortWithStats } from '../../types/database'

interface ResortForm {
  name: string
  default_weekday_limit: string
  default_weekend_limit: string
  max_invites_per_invitee_month: string
  weekend_days: number[]
}

const emptyForm: ResortForm = {
  name: '',
  default_weekday_limit: '8',
  default_weekend_limit: '3',
  max_invites_per_invitee_month: '',
  weekend_days: [5, 6],
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
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ResortWithStats | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadResorts = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Fetch resorts with counts via aggregation
    const { data, error: fetchError } = await supabase
      .from('resorts')
      .select('*, assets(count), invitations:assets(invitations(count))')
      .order('name')

    if (fetchError) {
      // Fallback: fetch resorts plain and compute counts separately
      const { data: plainData, error: plainError } = await supabase
        .from('resorts')
        .select('*')
        .order('name')

      if (plainError) {
        setError(plainError.message)
        setLoading(false)
        return
      }

      const withStats: ResortWithStats[] = await Promise.all(
        (plainData ?? []).map(async (resort) => {
          const [{ count: chaletsCount }, { count: invitesCount }] = await Promise.all([
            supabase
              .from('assets')
              .select('*', { count: 'exact', head: true })
              .eq('resort_id', resort.id)
              .then((r) => ({ count: r.count ?? 0 })),
            supabase
              .from('invitations')
              .select('*, assets!inner(resort_id)', { count: 'exact', head: true })
              .eq('assets.resort_id', resort.id)
              .then((r) => ({ count: r.count ?? 0 })),
          ])
          return { ...resort, chalet_count: chaletsCount, invitation_count: invitesCount }
        }),
      )

      setResorts(withStats)
    } else {
      // Parse nested counts from Supabase response
      const withStats: ResortWithStats[] = (data ?? []).map((row: Record<string, unknown>) => {
        const assetArr = Array.isArray(row.assets) ? row.assets : []
        const chaletsCount = assetArr.length > 0 && typeof assetArr[0] === 'object' && assetArr[0] !== null && 'count' in assetArr[0]
          ? Number((assetArr[0] as { count: unknown }).count)
          : assetArr.length

        return {
          id: row.id as string,
          name: row.name as string,
          weekend_days: row.weekend_days as number[],
          default_weekday_limit: row.default_weekday_limit as number,
          default_weekend_limit: row.default_weekend_limit as number,
          max_invites_per_invitee_month: row.max_invites_per_invitee_month as number | null,
          created_at: row.created_at as string,
          chalet_count: chaletsCount,
          invitation_count: 0,
        }
      })
      setResorts(withStats)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadResorts()
  }, [loadResorts])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(resort: ResortWithStats) {
    setEditingId(resort.id)
    setForm({
      name: resort.name,
      default_weekday_limit: String(resort.default_weekday_limit),
      default_weekend_limit: String(resort.default_weekend_limit),
      max_invites_per_invitee_month:
        resort.max_invites_per_invitee_month != null
          ? String(resort.max_invites_per_invitee_month)
          : '',
      weekend_days: [...resort.weekend_days],
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    if (!form.default_weekday_limit || !form.default_weekend_limit) {
      setFormError('Weekday and weekend limits are required')
      return
    }

    setSaving(true)
    setFormError(null)

    const payload = {
      name: form.name.trim(),
      default_weekday_limit: Number(form.default_weekday_limit),
      default_weekend_limit: Number(form.default_weekend_limit),
      max_invites_per_invitee_month: form.max_invites_per_invitee_month
        ? Number(form.max_invites_per_invitee_month)
        : null,
      weekend_days: form.weekend_days,
    }

    if (editingId) {
      const { error: updateError } = await supabase
        .from('resorts')
        .update(payload)
        .eq('id', editingId)

      if (updateError) { setFormError(updateError.message); setSaving(false); return }
    } else {
      const { error: insertError } = await supabase.from('resorts').insert(payload)
      if (insertError) { setFormError(insertError.message); setSaving(false); return }
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
          <h2 className="text-2xl font-semibold text-white">Resorts</h2>
          <p className="mt-1 text-sm text-slate-400">All resorts on the platform.</p>
        </div>
        <Button onClick={openCreate}>Add resort</Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Chalets</th>
              <th className="px-4 py-3 font-medium">Invitations</th>
              <th className="px-4 py-3 font-medium">Wkday limit</th>
              <th className="px-4 py-3 font-medium">Wkend limit</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {resorts.map((resort) => (
              <tr key={resort.id} className="bg-slate-950/50">
                <td className="px-4 py-3 font-medium text-white">{resort.name}</td>
                <td className="px-4 py-3 text-slate-300">{resort.chalet_count}</td>
                <td className="px-4 py-3 text-slate-300">{resort.invitation_count}</td>
                <td className="px-4 py-3 text-slate-300">{resort.default_weekday_limit}</td>
                <td className="px-4 py-3 text-slate-300">{resort.default_weekend_limit}</td>
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
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
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
          <div className="space-y-4">
            <Input
              label="Resort name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label="Default weekday limit"
              type="number"
              min={0}
              value={form.default_weekday_limit}
              onChange={(e) => setForm({ ...form, default_weekday_limit: e.target.value })}
            />
            <Input
              label="Default weekend limit"
              type="number"
              min={0}
              value={form.default_weekend_limit}
              onChange={(e) => setForm({ ...form, default_weekend_limit: e.target.value })}
            />
            <Input
              label="Max invites per invitee per month (blank = no cap)"
              type="number"
              min={0}
              value={form.max_invites_per_invitee_month}
              onChange={(e) =>
                setForm({ ...form, max_invites_per_invitee_month: e.target.value })
              }
            />
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-300">Weekend days</legend>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setForm({ ...form, weekend_days: toggleDay(form.weekend_days, day) })
                    }
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      form.weekend_days.includes(day)
                        ? 'bg-violet-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            {formError ? <p className="text-sm text-rose-400">{formError}</p> : null}
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
          <p className="text-slate-300">
            Delete <span className="font-semibold text-white">{deleteTarget.name}</span>?
          </p>
          <p className="mt-3 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">
            This will permanently delete the resort and cascade-delete{' '}
            <strong>all its chalets, rentals, invitations, staff, and blocklist entries</strong>.
            This cannot be undone.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
