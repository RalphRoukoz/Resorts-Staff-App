import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { UnitSearchSelect } from '../../components/UnitSearchSelect'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime } from '../../lib/dates'
import { notifyResortPush } from '../../lib/edgeFunctions'
import { PERMISSIONS } from '../../lib/permissions'
import { supabase } from '../../lib/supabase'

interface UnitMessageRow {
  id: string
  resort_id: string
  asset_id: string
  title: string
  body: string
  created_at: string
  assets?: { label: string; asset_type: string } | null
}

interface SelectedUnit {
  id: string
  label: string
}

export function MessagesPage() {
  const { resortId, hasPermission, session } = useAuth()
  const canWrite = hasPermission(PERMISSIONS.ANNOUNCEMENTS_WRITE)

  const [messages, setMessages] = useState<UnitMessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pickedId, setPickedId] = useState('')
  const [selectedUnits, setSelectedUnits] = useState<SelectedUnit[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [statusNote, setStatusNote] = useState<string | null>(null)

  const loadMessages = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('unit_messages')
      .select('id, resort_id, asset_id, title, body, created_at, assets(label, asset_type)')
      .eq('resort_id', resortId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (fetchError) setError(fetchError.message)
    else setMessages((data ?? []) as unknown as UnitMessageRow[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  function openCreate() {
    setTitle('')
    setBody('')
    setPickedId('')
    setSelectedUnits([])
    setFormError(null)
    setModalOpen(true)
  }

  function addUnit(assetId: string, option?: { id: string; label: string }) {
    if (!assetId || !option) return
    setSelectedUnits((current) =>
      current.some((u) => u.id === assetId) ? current : [...current, { id: option.id, label: option.label }],
    )
    setPickedId('')
  }

  function removeUnit(assetId: string) {
    setSelectedUnits((current) => current.filter((u) => u.id !== assetId))
  }

  async function handleSend() {
    if (!resortId || !canWrite) return
    if (!title.trim() || !body.trim()) {
      setFormError('Title and message are required.')
      return
    }
    if (selectedUnits.length === 0) {
      setFormError('Select at least one unit.')
      return
    }

    setSaving(true)
    setFormError(null)

    const rows = selectedUnits.map((unit) => ({
      resort_id: resortId,
      asset_id: unit.id,
      title: title.trim(),
      body: body.trim(),
      created_by: session?.user?.id ?? null,
    }))

    const { error: insertError } = await supabase.from('unit_messages').insert(rows)
    if (insertError) {
      setFormError(insertError.message)
      setSaving(false)
      return
    }

    const push = await notifyResortPush({
      resort_id: resortId,
      title: title.trim(),
      body: body.trim().slice(0, 180),
      asset_ids: selectedUnits.map((unit) => unit.id),
      data: {
        type: 'unit_message',
        path: '/messages',
      },
    })

    if (!push.ok) {
      setStatusNote(`Message saved, but push failed: ${push.message}`)
    } else if (push.sent === 0) {
      setStatusNote(
        'Message saved. No matching owner/tenant devices registered for push yet — they will still see it in the guest app inbox.',
      )
    } else {
      setStatusNote(`Message saved and pushed to ${push.sent} device${push.sent === 1 ? '' : 's'}.`)
    }

    setModalOpen(false)
    setSaving(false)
    await loadMessages()
  }

  if (loading) return <Spinner label="Loading messages…" />

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Messages</h2>
          <p className="mt-1 text-sm text-gray-500">
            One-way notes to specific chalets or cabines. Owners and tenants see these in the guest app only.
          </p>
        </div>
        {canWrite ? <Button onClick={openCreate}>New message</Button> : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}
      {statusNote ? (
        <p className="mb-4 rounded-xl border border-[#ECECEC] bg-white px-3 py-2 text-sm text-gray-600">{statusNote}</p>
      ) : null}

      <div className="space-y-3">
        {messages.map((message) => (
          <article
            key={message.id}
            className="rounded-2xl border border-[#ECECEC] bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-[#1A1A1A]">{message.title}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {message.assets?.label ?? 'Unit'} · {formatDateTime(message.created_at)}
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium capitalize text-gray-600">
                {message.assets?.asset_type ?? 'unit'}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{message.body}</p>
          </article>
        ))}
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#ECECEC] bg-white px-4 py-12 text-center text-sm text-gray-400">
            No unit messages yet.
          </div>
        ) : null}
      </div>

      {modalOpen && canWrite && resortId ? (
        <Modal
          title="Message units"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSend()} disabled={saving}>
                {saving ? 'Sending…' : 'Send'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Pool maintenance tomorrow"
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Message</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3 py-2.5 text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                placeholder="Write a short note for the selected units…"
              />
            </label>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Add units</span>
              <UnitSearchSelect resortId={resortId} value={pickedId} onChange={addUnit} />
              {selectedUnits.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedUnits.map((unit) => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => removeUnit(unit.id)}
                      className="rounded-full bg-[var(--accent)]/10 px-3 py-1.5 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
                    >
                      {unit.label} ×
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-500">Search and select one or more units.</p>
              )}
            </div>

            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
