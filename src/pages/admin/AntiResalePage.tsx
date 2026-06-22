import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime } from '../../lib/dates'
import { formatPhoneError, isValidE164 } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { BlockedInvitee, InviteeActivity } from '../../types/database'

const HIGH_CHALET_THRESHOLD = 2

interface BlockForm {
  invitee_phone: string
  reason: string
}

export function AntiResalePage() {
  const { resortId } = useAuth()
  const [activity, setActivity] = useState<InviteeActivity[]>([])
  const [blocked, setBlocked] = useState<BlockedInvitee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<BlockForm>({ invitee_phone: '', reason: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const [activityResult, blockedResult] = await Promise.all([
      supabase
        .from('invitee_activity')
        .select('*')
        .eq('resort_id', resortId)
        .order('distinct_chalets_this_month', { ascending: false }),
      supabase
        .from('blocked_invitees')
        .select('*')
        .eq('resort_id', resortId)
        .order('created_at', { ascending: false }),
    ])

    if (activityResult.error) setError(activityResult.error.message)
    else setActivity((activityResult.data ?? []) as InviteeActivity[])

    if (blockedResult.error) setError(blockedResult.error.message)
    else setBlocked((blockedResult.data ?? []) as BlockedInvitee[])

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function handleAddBlock() {
    if (!resortId) return
    if (!isValidE164(form.invitee_phone)) {
      setFormError(formatPhoneError())
      return
    }

    setSaving(true)
    setFormError(null)

    const { error: insertError } = await supabase.from('blocked_invitees').insert({
      resort_id: resortId,
      invitee_phone: form.invitee_phone.trim(),
      reason: form.reason.trim() || null,
    })

    if (insertError) setFormError(insertError.message)
    else {
      setModalOpen(false)
      setForm({ invitee_phone: '', reason: '' })
      await loadData()
    }
    setSaving(false)
  }

  async function handleRemoveBlock(item: BlockedInvitee) {
    if (!confirm(`Remove block for ${item.invitee_phone}?`)) return

    const { error: deleteError } = await supabase
      .from('blocked_invitees')
      .delete()
      .eq('id', item.id)

    if (deleteError) setError(deleteError.message)
    else await loadData()
  }

  if (loading) return <Spinner label="Loading anti-resale data…" />

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white">Anti-resale</h2>
        <p className="mt-1 text-sm text-slate-400">
          Monitor invitee activity and manage the blocklist.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      <section>
        <h3 className="mb-3 text-lg font-medium text-white">Invitee activity</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">This month</th>
                <th className="px-4 py-3 font-medium">Distinct chalets</th>
                <th className="px-4 py-3 font-medium">All time</th>
                <th className="px-4 py-3 font-medium">Last invited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {activity.map((row) => {
                const suspicious = row.distinct_chalets_this_month >= HIGH_CHALET_THRESHOLD
                return (
                  <tr
                    key={row.invitee_phone}
                    className={suspicious ? 'bg-rose-950/30' : 'bg-slate-950/50'}
                  >
                    <td
                      className={`px-4 py-3 font-medium ${suspicious ? 'text-rose-300' : 'text-white'}`}
                    >
                      {row.invitee_phone}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.invites_this_month}</td>
                    <td
                      className={`px-4 py-3 font-semibold ${suspicious ? 'text-rose-400' : 'text-slate-300'}`}
                    >
                      {row.distinct_chalets_this_month}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.invites_all_time}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {row.last_invited_at ? formatDateTime(row.last_invited_at) : '—'}
                    </td>
                  </tr>
                )
              })}
              {activity.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No invitee activity yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-lg font-medium text-white">Blocklist</h3>
          <Button onClick={() => setModalOpen(true)}>Add to blocklist</Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {blocked.map((row) => (
                <tr key={row.id} className="bg-slate-950/50">
                  <td className="px-4 py-3 font-medium text-white">{row.invitee_phone}</td>
                  <td className="px-4 py-3 text-slate-300">{row.reason ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Button variant="danger" onClick={() => void handleRemoveBlock(row)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
              {blocked.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                    Blocklist is empty.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <Modal
          title="Block invitee"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleAddBlock()} disabled={saving}>
                {saving ? 'Adding…' : 'Add'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label="Invitee phone (E.164)"
              value={form.invitee_phone}
              onChange={(event) => setForm({ ...form, invitee_phone: event.target.value })}
              placeholder="+96170123456"
            />
            <Input
              label="Reason (optional)"
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
            {formError ? <p className="text-sm text-rose-400">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
