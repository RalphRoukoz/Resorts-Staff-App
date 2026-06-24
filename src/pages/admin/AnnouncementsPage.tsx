import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
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
  const { resortId } = useAuth()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Audience>('both')
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
          <h2 className="text-2xl font-semibold text-white">Announcements</h2>
          <p className="mt-1 text-sm text-slate-400">Compose notices for chalets and cabines.</p>
        </div>
        <Button onClick={openCreate}>New announcement</Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      <div className="space-y-3">
        {announcements.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-medium text-white">{item.title}</h3>
                  <span className="inline-flex rounded-full bg-slate-700/50 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                    {audienceLabels[item.audience]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(item.created_at)}</p>
                {item.body ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{item.body}</p>
                ) : null}
                {item.pdf_url ? (
                  <a
                    href={item.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300"
                  >
                    View attachment (PDF)
                  </a>
                ) : null}
              </div>
              <Button variant="danger" onClick={() => void handleDelete(item)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
        {announcements.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-12 text-center text-slate-500">
            No announcements yet.
          </p>
        ) : null}
      </div>

      {modalOpen ? (
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
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Body (optional)</span>
              <textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Audience</span>
              <select
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-slate-100"
                value={audience}
                onChange={(e) => setAudience(e.target.value as Audience)}
              >
                <option value="both">Everyone</option>
                <option value="chalet">Chalets only</option>
                <option value="cabine">Cabines only</option>
              </select>
            </label>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-300">
                PDF attachment (optional)
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                className="block text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600"
              />
            </div>
            {formError ? <p className="text-sm text-rose-400">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
