import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { PERMISSIONS } from '../../lib/permissions'
import {
  EXPIRY_PRESET_LABELS,
  computeAnnouncementExpiresAt,
  isAnnouncementExpired,
  type AnnouncementExpiryPreset,
} from '../../lib/announcementExpiry'
import { formatDateTime } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { Announcement, Audience } from '../../types/database'

const FILES_BUCKET = 'announcement-files'

const audienceLabels: Record<Audience, string> = {
  chalet: 'Chalets',
  cabine: 'Cabines',
  both: 'Everyone',
}

export function AnnouncementsPage() {
  const { resortId, hasPermission } = useAuth()
  const canWrite = hasPermission(PERMISSIONS.ANNOUNCEMENTS_WRITE)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Audience>('both')
  const [expiryPreset, setExpiryPreset] = useState<AnnouncementExpiryPreset>('never')
  const [customExpiresAt, setCustomExpiresAt] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadAnnouncements = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('announcements')
      .select('*')
      .eq('resort_id', resortId)
      .order('created_at', { ascending: false })

    if (fetchError) setError(fetchError.message)
    else setAnnouncements((data ?? []) as Announcement[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadAnnouncements()
  }, [loadAnnouncements])

  function openCreate() {
    setTitle('')
    setBody('')
    setAudience('both')
    setExpiryPreset('never')
    setCustomExpiresAt('')
    setIsPublic(false)
    setPdfFile(null)
    setFormError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setModalOpen(true)
  }

  async function handleCreate() {
    if (!resortId) return
    if (!title.trim()) {
      setFormError('Title is required')
      return
    }

    const expiresAt = computeAnnouncementExpiresAt(expiryPreset, customExpiresAt)
    if (expiryPreset === 'custom' && !expiresAt) {
      setFormError('Choose a valid expiry date and time')
      return
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setFormError('Expiry must be in the future')
      return
    }

    setSaving(true)
    setFormError(null)

    let pdfUrl: string | null = null

    if (pdfFile) {
      const safeName = pdfFile.name.replace(/[^\w.-]/g, '_')
      const path = `${resortId}/${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from(FILES_BUCKET)
        .upload(path, pdfFile, { upsert: false, contentType: pdfFile.type || 'application/pdf' })

      if (uploadError) {
        setFormError(`PDF upload failed: ${uploadError.message}`)
        setSaving(false)
        return
      }

      const { data: publicData } = supabase.storage.from(FILES_BUCKET).getPublicUrl(path)
      pdfUrl = publicData.publicUrl
    }

    const { error: insertError } = await supabase.from('announcements').insert({
      resort_id: resortId,
      title: title.trim(),
      body: body.trim() || null,
      audience,
      pdf_url: pdfUrl,
      expires_at: expiresAt,
      is_public: isPublic,
    })

    if (insertError) {
      setFormError(insertError.message)
      setSaving(false)
      return
    }

    setModalOpen(false)
    await loadAnnouncements()
    setSaving(false)
  }

  async function handleDelete(item: Announcement) {
    if (!confirm(`Delete announcement "${item.title}"?`)) return

    const { error: deleteError } = await supabase
      .from('announcements')
      .delete()
      .eq('id', item.id)

    if (deleteError) setError(deleteError.message)
    else await loadAnnouncements()
  }

  if (loading) return <Spinner label="Loading announcements…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Announcements</h2>
          <p className="mt-1 text-sm text-gray-500">
            {canWrite ? 'Compose notices for chalets and cabines.' : 'Resort notices for chalets and cabines.'}
          </p>
        </div>
        {canWrite ? <Button onClick={openCreate}>New announcement</Button> : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="space-y-3">
        {announcements.map((item) => {
          const expired = isAnnouncementExpired(item.expires_at)
          return (
            <div
              key={item.id}
              className="rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-medium text-[#1A1A1A]">{item.title}</h3>
                    <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                      {audienceLabels[item.audience]}
                    </span>
                    {item.is_public ? (
                      <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
                        Public (guest app)
                      </span>
                    ) : null}
                    {item.expires_at ? (
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          expired
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {expired ? 'Expired' : `Expires ${formatDateTime(item.expires_at)}`}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">Posted {formatDateTime(item.created_at)}</p>
                  {item.body ? (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-gray-600">{item.body}</p>
                  ) : null}
                  {item.pdf_url ? (
                    <a
                      href={item.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:opacity-80"
                    >
                      View attachment (PDF)
                    </a>
                  ) : null}
                </div>
                {canWrite ? (
                  <Button variant="danger" onClick={() => void handleDelete(item)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          )
        })}
        {announcements.length === 0 ? (
          <p className="rounded-2xl border border-[#ECECEC] bg-white px-4 py-12 text-center text-gray-400 shadow-sm">
            No announcements yet.
          </p>
        ) : null}
      </div>

      {modalOpen && canWrite ? (
        <Modal
          title="New announcement"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreate()} disabled={saving}>
                {saving ? 'Posting…' : 'Post'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Body (optional)</span>
              <textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] placeholder:text-gray-400 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Audience</span>
              <select
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                value={audience}
                onChange={(e) => setAudience(e.target.value as Audience)}
              >
                <option value="both">Everyone</option>
                <option value="chalet">Chalets only</option>
                <option value="cabine">Cabines only</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-[#1A1A1A]">Show on guest Explore home</span>
                <span className="mt-0.5 block text-sm text-gray-500">
                  Visible to unsigned guests in the owner app Explore tab.
                </span>
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Auto-remove after</span>
              <select
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                value={expiryPreset}
                onChange={(e) => setExpiryPreset(e.target.value as AnnouncementExpiryPreset)}
              >
                {(Object.keys(EXPIRY_PRESET_LABELS) as AnnouncementExpiryPreset[]).map((key) => (
                  <option key={key} value={key}>
                    {EXPIRY_PRESET_LABELS[key]}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-gray-500">
                The announcement is hidden from owners when it expires, then deleted automatically.
              </p>
            </label>
            {expiryPreset === 'custom' ? (
              <Input
                label="Expiry date & time"
                type="datetime-local"
                value={customExpiresAt}
                onChange={(e) => setCustomExpiresAt(e.target.value)}
              />
            ) : null}
            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                PDF attachment (optional)
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                className="block text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-[#1A1A1A] hover:file:bg-gray-200"
              />
            </div>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
