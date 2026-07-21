import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { supabase } from '../../lib/supabase'
import type { ResortGalleryImage } from '../../types/database'

const GUEST_BUCKET = 'resort-guest'

type PendingPreview = { url: string; file: File }

export function SuperGalleryPage() {
  const { resortId } = useParams<{ resortId: string }>()
  const [resortName, setResortName] = useState('')
  const [images, setImages] = useState<ResortGalleryImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [pending, setPending] = useState<PendingPreview[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const [resortRes, galleryRes] = await Promise.all([
      supabase.from('resorts').select('name').eq('id', resortId).single(),
      supabase
        .from('resort_gallery_images')
        .select('*')
        .eq('resort_id', resortId)
        .order('sort_order'),
    ])

    if (resortRes.error) setError(resortRes.error.message)
    else setResortName((resortRes.data as { name: string }).name)

    if (galleryRes.error) setError(galleryRes.error.message)
    else setImages((galleryRes.data ?? []) as ResortGalleryImage[])

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void load()
  }, [load])

  function clearPending() {
    for (const item of pending) URL.revokeObjectURL(item.url)
    setPending([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function openModal() {
    clearPending()
    setCaption('')
    setSortOrder('0')
    setFormError(null)
    setModalOpen(true)
  }

  function onPickFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    const next = files.map((file) => ({ url: URL.createObjectURL(file), file }))
    setPending((prev) => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removePending(index: number) {
    setPending((prev) => {
      const copy = [...prev]
      const [removed] = copy.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.url)
      return copy
    })
  }

  async function handleAdd() {
    if (!resortId || pending.length === 0) {
      setFormError('Choose at least one image')
      return
    }

    setSaving(true)
    setFormError(null)
    const baseOrder = Number(sortOrder) || 0

    try {
      for (let i = 0; i < pending.length; i++) {
        const item = pending[i]
        const ext = item.file.name.split('.').pop() || 'jpg'
        const path = `${resortId}/gallery/${Date.now()}-${i}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from(GUEST_BUCKET)
          .upload(path, item.file, { contentType: item.file.type })
        if (uploadError) throw uploadError

        const { data: publicData } = supabase.storage.from(GUEST_BUCKET).getPublicUrl(path)

        const { error: insertError } = await supabase.from('resort_gallery_images').insert({
          resort_id: resortId,
          image_url: publicData.publicUrl,
          caption: i === 0 ? caption.trim() || null : null,
          sort_order: baseOrder + i,
          is_published: true,
        })
        if (insertError) throw insertError
      }

      clearPending()
      setModalOpen(false)
      setCaption('')
      setSortOrder('0')
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Upload failed')
    }
    setSaving(false)
  }

  async function togglePublished(item: ResortGalleryImage) {
    const { error: updateError } = await supabase
      .from('resort_gallery_images')
      .update({ is_published: !item.is_published })
      .eq('id', item.id)
    if (updateError) setError(updateError.message)
    else await load()
  }

  async function handleDelete(item: ResortGalleryImage) {
    if (!confirm('Delete this gallery image?')) return
    const { error: deleteError } = await supabase.from('resort_gallery_images').delete().eq('id', item.id)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  if (loading) return <Spinner label="Loading gallery…" />

  return (
    <div>
      <div className="mb-6">
        <Link to="/superadmin/resorts" className="text-sm font-medium text-[var(--accent)] hover:opacity-80">
          ← Back to resorts
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#1A1A1A]">
          Gallery — {resortName}
        </h2>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="mb-4">
        <Button onClick={openModal}>Add images</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
            <img src={item.image_url} alt={item.caption ?? ''} className="aspect-square w-full object-cover" />
            <div className="space-y-2 p-3">
              {item.caption ? <p className="text-sm text-gray-600">{item.caption}</p> : null}
              <p className="text-xs text-gray-400">Order {item.sort_order}</p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void togglePublished(item)}>
                  {item.is_published ? 'Unpublish' : 'Publish'}
                </Button>
                <Button variant="danger" onClick={() => void handleDelete(item)}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modalOpen ? (
        <Modal
          title="Add gallery images"
          onClose={() => {
            clearPending()
            setModalOpen(false)
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  clearPending()
                  setModalOpen(false)
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleAdd()} disabled={saving || pending.length === 0}>
                {saving ? 'Uploading…' : `Upload ${pending.length || ''}`.trim()}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onPickFiles(e.target.files)}
            />
            {pending.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2">
                {pending.map((item, index) => (
                  <li key={item.url} className="relative overflow-hidden rounded-xl border border-[#ECECEC]">
                    <img src={item.url} alt="" className="aspect-square w-full object-cover" />
                    <button
                      type="button"
                      className="absolute end-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                      onClick={() => removePending(index)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-500">Select one or more images — previews appear immediately.</p>
            )}
            <Input label="Caption (first image)" value={caption} onChange={(e) => setCaption(e.target.value)} />
            <Input
              label="Starting sort order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
