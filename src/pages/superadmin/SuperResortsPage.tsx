import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { DAY_LABELS } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { Resort, ResortWithStats } from '../../types/database'

interface ResortForm {
  name: string
  chalet_weekday_limit: string
  chalet_weekend_limit: string
  cabine_weekday_limit: string
  cabine_weekend_limit: string
  weekend_days: number[]
}

const emptyForm: ResortForm = {
  name: '',
  chalet_weekday_limit: '8',
  chalet_weekend_limit: '3',
  cabine_weekday_limit: '8',
  cabine_weekend_limit: '3',
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

    const { data, error: fetchError } = await supabase
      .from('resorts')
      .select('*')
      .order('name')

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const withStats: ResortWithStats[] = await Promise.all(
      ((data ?? []) as Resort[]).map(async (resort) => {
        const [chaletsResult, invitesResult] = await Promise.all([
          supabase
            .from('assets')
            .select('*', { count: 'exact', head: true })
            .eq('resort_id', resort.id),
          supabase
            .from('invitations')
            .select('*, assets!inner(resort_id)', { count: 'exact', head: true })
            .eq('assets.resort_id', resort.id),
        ])
        return {
          ...resort,
          chalet_count: chaletsResult.count ?? 0,
          invitation_count: invitesResult.count ?? 0,
        }
      }),
    )

    setResorts(withStats)
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
      chalet_weekday_limit: String(resort.chalet_weekday_limit),
      chalet_weekend_limit: String(resort.chalet_weekend_limit),
      cabine_weekday_limit: String(resort.cabine_weekday_limit),
      cabine_weekend_limit: String(resort.cabine_weekend_limit),
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

    setSaving(true)
    setFormError(null)

    const payload = {
      name: form.name.trim(),
      chalet_weekday_limit: Number(form.chalet_weekday_limit),
      chalet_weekend_limit: Number(form.chalet_weekend_limit),
      cabine_weekday_limit: Number(form.cabine_weekday_limit),
      cabine_weekend_limit: Number(form.cabine_weekend_limit),
      weekend_days: form.weekend_days,
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
              <th className="px-4 py-3 font-medium">Units</th>
              <th className="px-4 py-3 font-medium">Invitations</th>
              <th className="px-4 py-3 font-medium">Chalet (wd/we)</th>
              <th className="px-4 py-3 font-medium">Cabine (wd/we)</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {resorts.map((resort) => (
              <tr key={resort.id} className="bg-slate-950/50">
                <td className="px-4 py-3 font-medium text-white">{resort.name}</td>
                <td className="px-4 py-3 text-slate-300">{resort.chalet_count}</td>
                <td className="px-4 py-3 text-slate-300">{resort.invitation_count}</td>
                <td className="px-4 py-3 text-slate-300">
                  {resort.chalet_weekday_limit} / {resort.chalet_weekend_limit}
                </td>
                <td className="px-4 py-3 text-slate-300">
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
              />
              <Input
                label="Cabine weekend limit"
                type="number"
                min={0}
                value={form.cabine_weekend_limit}
                onChange={(e) => setForm({ ...form, cabine_weekend_limit: e.target.value })}
              />
            </div>
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
            <strong>all its units, rentals, invitations, staff, and announcements</strong>. This
            cannot be undone.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
