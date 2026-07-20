import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { supabase } from '../../lib/supabase'
import type { ResortGalleryImage } from '../../types/database'

const GUEST_BUCKET = 'resort-guest'

export function SuperGalleryPage() {
  const { resortId } = useParams<{ resortId: string }>()
  const [resortName, setResortName] = useState('')
  const [images, setImages] = useState<ResortGalleryImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

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

  async function handleAdd() {
    if (!resortId || !imageFile) {
      setFormError('Choose an image')
      return
    }

    setSaving(true)
    setFormError(null)

    try {
      const ext = imageFile.name.split('.').pop() || 'jpg'
      const path = `${resortId}/gallery/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from(GUEST_BUCKET)
        .upload(path, imageFile, { contentType: imageFile.type })
      if (uploadError) throw uploadError

      const { data: publicData } = supabase.storage.from(GUEST_BUCKET).getPublicUrl(path)

      const { error: insertError } = await supabase.from('resort_gallery_images').insert({
        resort_id: resortId,
        image_url: publicData.publicUrl,
        caption: caption.trim() || null,
        sort_order: Number(sortOrder) || 0,
        is_published: true,
      })
      if (insertError) throw insertError

      setModalOpen(false)
      setCaption('')
      setSortOrder('0')
      setImageFile(null)
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
        <Button onClick={() => setModalOpen(true)}>Add image</Button>
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
          title="Add gallery image"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleAdd()} disabled={saving}>
                {saving ? 'Uploading…' : 'Add'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
            <Input label="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
            <Input label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
