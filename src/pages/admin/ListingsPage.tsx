import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { PERMISSIONS } from '../../lib/permissions'
import { supabase } from '../../lib/supabase'
import type { ListingType, MarketplaceListing } from '../../types/database'

const FILES_BUCKET = 'listing-images'
const MAX_IMAGES = 12
const FEED_PAGE = 50

type TypeFilter = 'all' | ListingType

type ListingForm = {
  listing_type: ListingType
  title: string
  description: string
  price_usd: string
  size_sqm: string
  beds: string
  baths: string
  block: string
  floor_number: string
  chalet_number: string
  call_phone: string
  whatsapp_phone: string
  is_featured: boolean
  is_published: boolean
}

const emptyForm = (): ListingForm => ({
  listing_type: 'sale',
  title: '',
  description: '',
  price_usd: '',
  size_sqm: '',
  beds: '',
  baths: '',
  block: '',
  floor_number: '',
  chalet_number: '',
  call_phone: '',
  whatsapp_phone: '',
  is_featured: false,
  is_published: false,
})

function storagePathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${FILES_BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}

function formFromListing(item: MarketplaceListing): ListingForm {
  return {
    listing_type: item.listing_type,
    title: item.title,
    description: item.description ?? '',
    price_usd: String(item.price_usd ?? ''),
    size_sqm: item.size_sqm != null ? String(item.size_sqm) : '',
    beds: item.beds != null ? String(item.beds) : '',
    baths: item.baths != null ? String(item.baths) : '',
    block: item.block ?? '',
    floor_number: item.floor_number ?? '',
    chalet_number: item.chalet_number ?? '',
    call_phone: item.call_phone ?? '',
    whatsapp_phone: item.whatsapp_phone ?? '',
    is_featured: item.is_featured,
    is_published: item.is_published,
  }
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number.parseInt(trimmed, 10)
  return Number.isFinite(n) ? n : null
}

function parseOptionalFloat(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) ? n : null
}

export function ListingsPage() {
  const { resortId, hasPermission, session } = useAuth()
  const canManage = hasPermission(PERMISSIONS.LISTINGS_WRITE)

  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<MarketplaceListing | null>(null)
  const [form, setForm] = useState<ListingForm>(emptyForm)
  const [managedImages, setManagedImages] = useState<string[]>([])
  const [pendingByUrl, setPendingByUrl] = useState<Record<string, File>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadListings = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    let query = supabase
      .from('marketplace_listings')
      .select('*')
      .eq('resort_id', resortId)
      .order('is_featured', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(FEED_PAGE)

    if (typeFilter !== 'all') {
      query = query.eq('listing_type', typeFilter)
    }

    const { data, error: fetchError } = await query
    if (fetchError) setError(fetchError.message)
    else setListings((data ?? []) as MarketplaceListing[])
    setLoading(false)
  }, [resortId, typeFilter])

  useEffect(() => {
    void loadListings()
  }, [loadListings])

  const filteredHint = useMemo(() => {
    if (typeFilter === 'all') return `${listings.length} listings`
    return `${listings.length} ${typeFilter} listings`
  }, [listings.length, typeFilter])

  function revokePendingUrls(urls: string[]) {
    setPendingByUrl((prev) => {
      const next = { ...prev }
      for (const url of urls) {
        if (next[url]) {
          URL.revokeObjectURL(url)
          delete next[url]
        }
      }
      return next
    })
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    revokePendingUrls(Object.keys(pendingByUrl))
    setManagedImages([])
    setPendingByUrl({})
    setFormError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setModalOpen(true)
  }

  function openEdit(item: MarketplaceListing) {
    setEditing(item)
    setForm(formFromListing(item))
    revokePendingUrls(Object.keys(pendingByUrl))
    setManagedImages([...(item.images ?? [])])
    setPendingByUrl({})
    setFormError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setModalOpen(true)
  }

  function moveImage(index: number, direction: -1 | 1) {
    setManagedImages((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      return next
    })
  }

  function removeManagedImage(index: number) {
    setManagedImages((prev) => {
      const url = prev[index]
      if (url && pendingByUrl[url]) {
        URL.revokeObjectURL(url)
        setPendingByUrl((map) => {
          const next = { ...map }
          delete next[url]
          return next
        })
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  function onPickImages(fileList: FileList | null) {
    const remaining = Math.max(0, MAX_IMAGES - managedImages.length)
    const files = Array.from(fileList ?? []).slice(0, remaining)
    if (files.length === 0) return

    const additions: string[] = []
    const pending: Record<string, File> = {}
    for (const file of files) {
      const url = URL.createObjectURL(file)
      additions.push(url)
      pending[url] = file
    }
    setManagedImages((prev) => [...prev, ...additions])
    setPendingByUrl((prev) => ({ ...prev, ...pending }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function uploadFiles(listingId: string, files: File[]): Promise<string[]> {
    if (!resortId || files.length === 0) return []
    const urls: string[] = []
    for (const file of files) {
      const safeName = file.name.replace(/[^\w.-]/g, '_')
      const path = `${resortId}/${listingId}/${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from(FILES_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' })
      if (uploadError) throw new Error(uploadError.message)
      const { data: publicData } = supabase.storage.from(FILES_BUCKET).getPublicUrl(path)
      urls.push(publicData.publicUrl)
    }
    return urls
  }

  async function purgeListingImages(item: MarketplaceListing) {
    if (!resortId) return
    const paths = new Set<string>()
    for (const url of item.images ?? []) {
      const p = storagePathFromPublicUrl(url)
      if (p) paths.add(p)
    }
    if (item.cover_url) {
      const p = storagePathFromPublicUrl(item.cover_url)
      if (p) paths.add(p)
    }
    const prefix = `${resortId}/${item.id}`
    const { data: listed } = await supabase.storage.from(FILES_BUCKET).list(prefix, { limit: 100 })
    for (const obj of listed ?? []) {
      if (obj.name) paths.add(`${prefix}/${obj.name}`)
    }
    const toRemove = [...paths]
    if (toRemove.length > 0) {
      await supabase.storage.from(FILES_BUCKET).remove(toRemove)
    }
  }

  async function handleSave() {
    if (!resortId || !canManage) return
    if (!form.title.trim()) {
      setFormError('Title is required')
      return
    }
    const price = parseOptionalFloat(form.price_usd)
    if (price == null || price < 0) {
      setFormError('Enter a valid price in USD')
      return
    }

    const existingRemote = managedImages.filter((url) => !pendingByUrl[url]).length
    const pendingCount = managedImages.filter((url) => pendingByUrl[url]).length
    if (existingRemote + pendingCount > MAX_IMAGES) {
      setFormError(`Maximum ${MAX_IMAGES} images per listing`)
      return
    }

    setSaving(true)
    setFormError(null)

    const payload = {
      resort_id: resortId,
      listing_type: form.listing_type,
      title: form.title.trim(),
      description: form.description.trim() || null,
      price_usd: price,
      size_sqm: parseOptionalFloat(form.size_sqm),
      beds: parseOptionalInt(form.beds),
      baths: parseOptionalInt(form.baths),
      block: form.block.trim() || null,
      floor_number: form.floor_number.trim() || null,
      chalet_number: form.chalet_number.trim() || null,
      call_phone: form.call_phone.trim() || null,
      whatsapp_phone: form.whatsapp_phone.trim() || null,
      is_featured: form.is_featured,
      is_published: form.is_published,
      sort_order: editing?.sort_order ?? 0,
      created_by: session?.user?.id ?? null,
    }

    try {
      let listingId = editing?.id
      const previousImages = editing?.images ?? []
      const orderedUrls = [...managedImages]
      const filesToUpload = orderedUrls
        .map((url) => pendingByUrl[url])
        .filter((file): file is File => Boolean(file))

      if (editing) {
        const { error: updateError } = await supabase
          .from('marketplace_listings')
          .update({
            ...payload,
            created_by: editing.created_by,
          })
          .eq('id', editing.id)
          .eq('resort_id', resortId)
        if (updateError) throw new Error(updateError.message)
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('marketplace_listings')
          .insert({ ...payload, images: [], cover_url: null })
          .select('id')
          .single()
        if (insertError) throw new Error(insertError.message)
        listingId = inserted.id as string
      }

      if (!listingId) throw new Error('Missing listing id')

      const uploaded = await uploadFiles(listingId, filesToUpload)
      let uploadCursor = 0
      const images = orderedUrls.map((url) => {
        if (pendingByUrl[url]) {
          const next = uploaded[uploadCursor]
          uploadCursor += 1
          return next
        }
        return url
      })

      const cover = images[0] ?? null
      const imagesChanged =
        !editing ||
        filesToUpload.length > 0 ||
        previousImages.length !== images.length ||
        previousImages.some((url, i) => url !== images[i]) ||
        (editing.cover_url ?? null) !== cover

      if (imagesChanged) {
        const { error: imgError } = await supabase
          .from('marketplace_listings')
          .update({ images, cover_url: cover })
          .eq('id', listingId)
          .eq('resort_id', resortId)
        if (imgError) throw new Error(imgError.message)
      }

      const kept = new Set(images)
      const removedPaths = previousImages
        .filter((url) => !kept.has(url))
        .map((url) => storagePathFromPublicUrl(url))
        .filter((p): p is string => Boolean(p))
      if (removedPaths.length > 0) {
        await supabase.storage.from(FILES_BUCKET).remove(removedPaths)
      }

      for (const url of Object.keys(pendingByUrl)) {
        URL.revokeObjectURL(url)
      }
      setPendingByUrl({})
      setModalOpen(false)
      await loadListings()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: MarketplaceListing) {
    if (!canManage) return
    if (!confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) return

    try {
      await purgeListingImages(item)
      const { error: deleteError } = await supabase
        .from('marketplace_listings')
        .delete()
        .eq('id', item.id)
        .eq('resort_id', resortId!)
      if (deleteError) {
        setError(deleteError.message)
        return
      }
      await loadListings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function toggleFlag(item: MarketplaceListing, field: 'is_featured' | 'is_published') {
    if (!canManage || !resortId) return
    const { error: updateError } = await supabase
      .from('marketplace_listings')
      .update({ [field]: !item[field] })
      .eq('id', item.id)
      .eq('resort_id', resortId)
    if (updateError) setError(updateError.message)
    else await loadListings()
  }

  if (loading) return <Spinner label="Loading listings…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Marketplace</h2>
          <p className="mt-1 text-sm text-gray-500">
            {canManage
              ? 'Sale and rental listings shown in the resort app. Delete removes the row and images permanently.'
              : 'Published and draft listings for this resort.'}
          </p>
          <p className="mt-1 text-xs text-gray-400">{filteredHint}</p>
        </div>
        {canManage ? <Button onClick={openCreate}>New listing</Button> : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'sale', 'rental'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTypeFilter(key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              typeFilter === key
                ? 'bg-[var(--accent)] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {key === 'all' ? 'All' : key === 'sale' ? 'For sale' : 'For rent'}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {listings.map((item) => (
          <div key={item.id} className="rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start gap-4">
              {item.cover_url || item.images?.[0] ? (
                <img
                  src={item.cover_url || item.images[0]}
                  alt=""
                  className="h-24 w-32 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">
                  No image
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-medium text-[#1A1A1A]">{item.title}</h3>
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    {item.listing_type === 'sale' ? 'Sale' : 'Rental'}
                  </span>
                  {item.is_featured ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      Featured
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      item.is_published ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {item.is_published ? 'Published' : 'Draft'}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#1A1A1A]">
                  USD {Number(item.price_usd).toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {[item.beds != null ? `${item.beds} beds` : null, item.baths != null ? `${item.baths} baths` : null, item.size_sqm != null ? `${item.size_sqm} sqm` : null]
                    .filter(Boolean)
                    .join(' · ') || 'No specs'}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {[item.block && `Block ${item.block}`, item.floor_number && `Floor ${item.floor_number}`, item.chalet_number && `Chalet ${item.chalet_number}`]
                    .filter(Boolean)
                    .join(' · ') || 'No location tags'}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-col gap-2">
                  <Button variant="secondary" onClick={() => openEdit(item)}>
                    Edit
                  </Button>
                  <Button variant="secondary" onClick={() => void toggleFlag(item, 'is_featured')}>
                    {item.is_featured ? 'Unfeature' : 'Feature'}
                  </Button>
                  <Button variant="secondary" onClick={() => void toggleFlag(item, 'is_published')}>
                    {item.is_published ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button variant="danger" onClick={() => void handleDelete(item)}>
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {listings.length === 0 ? (
          <p className="rounded-2xl border border-[#ECECEC] bg-white px-4 py-12 text-center text-gray-400 shadow-sm">
            No listings yet.
          </p>
        ) : null}
      </div>

      {modalOpen && canManage ? (
        <Modal
          title={editing ? 'Edit listing' : 'New listing'}
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
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pe-1">
            {formError ? (
              <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {formError}
              </p>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Type</span>
              <select
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A]"
                value={form.listing_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, listing_type: e.target.value as ListingType }))
                }
              >
                <option value="sale">For sale</option>
                <option value="rental">For rent</option>
              </select>
            </label>
            <Input
              label="Title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Description</span>
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A]"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Price (USD)"
                type="number"
                min="0"
                step="0.01"
                value={form.price_usd}
                onChange={(e) => setForm((f) => ({ ...f, price_usd: e.target.value }))}
              />
              <Input
                label="Size (sqm)"
                type="number"
                min="0"
                step="0.01"
                value={form.size_sqm}
                onChange={(e) => setForm((f) => ({ ...f, size_sqm: e.target.value }))}
              />
              <Input
                label="Beds"
                type="number"
                min="0"
                value={form.beds}
                onChange={(e) => setForm((f) => ({ ...f, beds: e.target.value }))}
              />
              <Input
                label="Baths"
                type="number"
                min="0"
                value={form.baths}
                onChange={(e) => setForm((f) => ({ ...f, baths: e.target.value }))}
              />
              <Input
                label="Block"
                value={form.block}
                onChange={(e) => setForm((f) => ({ ...f, block: e.target.value }))}
              />
              <Input
                label="Floor number"
                value={form.floor_number}
                onChange={(e) => setForm((f) => ({ ...f, floor_number: e.target.value }))}
              />
              <Input
                label="Chalet number"
                value={form.chalet_number}
                onChange={(e) => setForm((f) => ({ ...f, chalet_number: e.target.value }))}
              />
              <Input
                label="Call phone (E.164)"
                value={form.call_phone}
                placeholder="96170123456"
                inputMode="tel"
                onChange={(e) => setForm((f) => ({ ...f, call_phone: e.target.value }))}
              />
              <Input
                label="WhatsApp phone (E.164)"
                value={form.whatsapp_phone}
                placeholder="96170123456"
                inputMode="tel"
                onChange={(e) => setForm((f) => ({ ...f, whatsapp_phone: e.target.value }))}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_featured}
                  onChange={(e) => setForm((f) => ({ ...f, is_featured: e.target.checked }))}
                />
                Featured
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_published}
                  onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
                />
                Published
              </label>
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Images (max {MAX_IMAGES}, jpeg/png/webp)
              </span>
              {managedImages.length > 0 ? (
                <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {managedImages.map((url, index) => (
                    <li
                      key={`${url}-${index}`}
                      className="overflow-hidden rounded-xl border border-[#ECECEC] bg-[#FAFAFA]"
                    >
                      <div className="relative aspect-[4/3] bg-gray-100">
                        <img src={url} alt="" className="h-full w-full object-cover" />
                        {index === 0 ? (
                          <span className="absolute start-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            Cover
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-between gap-1 p-2">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="rounded-lg border border-[#ECECEC] bg-white px-2 py-1 text-xs text-gray-600 disabled:opacity-40"
                            disabled={index === 0}
                            onClick={() => moveImage(index, -1)}
                            aria-label="Move earlier"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-[#ECECEC] bg-white px-2 py-1 text-xs text-gray-600 disabled:opacity-40"
                            disabled={index === managedImages.length - 1}
                            onClick={() => moveImage(index, 1)}
                            aria-label="Move later"
                          >
                            ↓
                          </button>
                        </div>
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          onClick={() => removeManagedImage(index)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-2 text-xs text-gray-500">No images yet. First image becomes the cover.</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={(e) => onPickImages(e.target.files)}
                className="block text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium"
              />
              <p className="mt-1 text-xs text-gray-500">
                Select multiple images — previews appear immediately. First image is the cover. Upload happens on save.
              </p>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
