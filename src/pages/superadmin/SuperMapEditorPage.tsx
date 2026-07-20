import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { supabase } from '../../lib/supabase'
import type { PoiType, ResortMapPoi } from '../../types/database'

const GUEST_BUCKET = 'resort-guest'
const POI_TYPES: PoiType[] = ['restaurant', 'sports', 'playground', 'pool', 'beach', 'other']

type PoiForm = {
  poi_type: PoiType
  title: string
  description: string
  hours_note: string
  x_pct: string
  y_pct: string
  sort_order: string
  is_published: boolean
  image_url: string | null
  menu_urls: string
}

const emptyPoiForm = (): PoiForm => ({
  poi_type: 'restaurant',
  title: '',
  description: '',
  hours_note: '',
  x_pct: '50',
  y_pct: '50',
  sort_order: '0',
  is_published: true,
  image_url: null,
  menu_urls: '',
})

export function SuperMapEditorPage() {
  const { resortId } = useParams<{ resortId: string }>()
  const [resortName, setResortName] = useState('')
  const [mapImageUrl, setMapImageUrl] = useState<string | null>(null)
  const [pois, setPois] = useState<ResortMapPoi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapFile, setMapFile] = useState<File | null>(null)
  const [savingMap, setSavingMap] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPoiId, setEditingPoiId] = useState<string | null>(null)
  const [poiForm, setPoiForm] = useState<PoiForm>(emptyPoiForm())
  const [poiImageFile, setPoiImageFile] = useState<File | null>(null)
  const [poiFormError, setPoiFormError] = useState<string | null>(null)
  const [savingPoi, setSavingPoi] = useState(false)
  const mapInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const [resortRes, poisRes] = await Promise.all([
      supabase.from('resorts').select('name, map_image_url').eq('id', resortId).single(),
      supabase.from('resort_map_pois').select('*').eq('resort_id', resortId).order('sort_order'),
    ])

    if (resortRes.error) setError(resortRes.error.message)
    else {
      setResortName((resortRes.data as { name: string }).name)
      setMapImageUrl((resortRes.data as { map_image_url: string | null }).map_image_url)
    }

    if (poisRes.error) setError(poisRes.error.message)
    else setPois((poisRes.data ?? []) as ResortMapPoi[])

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void load()
  }, [load])

  async function uploadGuestFile(file: File, subfolder: string) {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${resortId}/${subfolder}/${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from(GUEST_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type })
    if (uploadError) throw uploadError
    const { data } = supabase.storage.from(GUEST_BUCKET).getPublicUrl(path)
    return data.publicUrl
  }

  async function handleSaveMapImage() {
    if (!resortId || !mapFile) return
    setSavingMap(true)
    setError(null)
    try {
      const url = await uploadGuestFile(mapFile, 'map')
      const { error: updateError } = await supabase
        .from('resorts')
        .update({ map_image_url: url })
        .eq('id', resortId)
      if (updateError) throw updateError
      setMapImageUrl(url)
      setMapFile(null)
      if (mapInputRef.current) mapInputRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
    setSavingMap(false)
  }

  function openCreatePoi(x = 50, y = 50) {
    setEditingPoiId(null)
    setPoiForm({ ...emptyPoiForm(), x_pct: String(x), y_pct: String(y) })
    setPoiImageFile(null)
    setPoiFormError(null)
    setModalOpen(true)
  }

  function openEditPoi(poi: ResortMapPoi) {
    setEditingPoiId(poi.id)
    setPoiForm({
      poi_type: poi.poi_type,
      title: poi.title,
      description: poi.description ?? '',
      hours_note: poi.hours_note ?? '',
      x_pct: String(poi.x_pct),
      y_pct: String(poi.y_pct),
      sort_order: String(poi.sort_order),
      is_published: poi.is_published,
      image_url: poi.image_url,
      menu_urls: (poi.menu_urls ?? []).join('\n'),
    })
    setPoiImageFile(null)
    setPoiFormError(null)
    setModalOpen(true)
  }

  function handleMapClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!mapImageUrl) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
    openCreatePoi(Math.round(x * 100) / 100, Math.round(y * 100) / 100)
  }

  async function handleSavePoi() {
    if (!resortId || !poiForm.title.trim()) {
      setPoiFormError('Title is required')
      return
    }

    setSavingPoi(true)
    setPoiFormError(null)

    try {
      let imageUrl = poiForm.image_url
      if (poiImageFile) imageUrl = await uploadGuestFile(poiImageFile, 'pois')

      const menuUrls = poiForm.menu_urls
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)

      const payload = {
        resort_id: resortId,
        poi_type: poiForm.poi_type,
        title: poiForm.title.trim(),
        description: poiForm.description.trim() || null,
        hours_note: poiForm.hours_note.trim() || null,
        x_pct: Number(poiForm.x_pct) || 0,
        y_pct: Number(poiForm.y_pct) || 0,
        sort_order: Number(poiForm.sort_order) || 0,
        is_published: poiForm.is_published,
        image_url: imageUrl,
        menu_urls: menuUrls,
      }

      if (editingPoiId) {
        const { error: updateError } = await supabase
          .from('resort_map_pois')
          .update(payload)
          .eq('id', editingPoiId)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase.from('resort_map_pois').insert(payload)
        if (insertError) throw insertError
      }

      setModalOpen(false)
      await load()
    } catch (e) {
      setPoiFormError(e instanceof Error ? e.message : 'Save failed')
    }
    setSavingPoi(false)
  }

  async function handleDeletePoi(poi: ResortMapPoi) {
    if (!confirm(`Delete "${poi.title}"?`)) return
    const { error: deleteError } = await supabase.from('resort_map_pois').delete().eq('id', poi.id)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  if (loading) return <Spinner label="Loading map editor…" />

  return (
    <div>
      <div className="mb-6">
        <Link to="/superadmin/resorts" className="text-sm font-medium text-[var(--accent)] hover:opacity-80">
          ← Back to resorts
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#1A1A1A]">
          Map editor — {resortName}
        </h2>
        <p className="mt-1 text-sm text-gray-500">Upload a map image and place points of interest.</p>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <section className="mb-8 space-y-4 rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-medium">Map image</h3>
        <input
          ref={mapInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => setMapFile(e.target.files?.[0] ?? null)}
          className="block text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium"
        />
        {mapFile ? (
          <Button onClick={() => void handleSaveMapImage()} disabled={savingMap}>
            {savingMap ? 'Uploading…' : 'Upload map image'}
          </Button>
        ) : null}
        {mapImageUrl ? (
          <div
            className="relative cursor-crosshair overflow-hidden rounded-xl border border-[#ECECEC]"
            onClick={handleMapClick}
            role="presentation"
          >
            <img src={mapImageUrl} alt="Resort map" className="block w-full select-none" draggable={false} />
            {pois.map((poi) => (
              <button
                key={poi.id}
                type="button"
                className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--accent)] shadow"
                style={{ left: `${poi.x_pct}%`, top: `${poi.y_pct}%` }}
                title={poi.title}
                onClick={(e) => {
                  e.stopPropagation()
                  openEditPoi(poi)
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Upload a map image to start placing POIs. Click the map to add a place.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Places ({pois.length})</h3>
          <Button onClick={() => openCreatePoi()}>Add place</Button>
        </div>
        {pois.map((poi) => (
          <div
            key={poi.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ECECEC] bg-white p-4 shadow-sm"
          >
            <div>
              <p className="font-medium text-[#1A1A1A]">{poi.title}</p>
              <p className="text-sm text-gray-500">
                {poi.poi_type} · {poi.x_pct}%, {poi.y_pct}%
                {!poi.is_published ? ' · draft' : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => openEditPoi(poi)}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => void handleDeletePoi(poi)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </section>

      {modalOpen ? (
        <Modal
          title={editingPoiId ? 'Edit place' : 'Add place'}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSavePoi()} disabled={savingPoi}>
                {savingPoi ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label="Title" value={poiForm.title} onChange={(e) => setPoiForm({ ...poiForm, title: e.target.value })} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Type</span>
              <select
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5"
                value={poiForm.poi_type}
                onChange={(e) => setPoiForm({ ...poiForm, poi_type: e.target.value as PoiType })}
              >
                {POI_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Input label="X %" value={poiForm.x_pct} onChange={(e) => setPoiForm({ ...poiForm, x_pct: e.target.value })} />
              <Input label="Y %" value={poiForm.y_pct} onChange={(e) => setPoiForm({ ...poiForm, y_pct: e.target.value })} />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Description</span>
              <textarea
                rows={3}
                value={poiForm.description}
                onChange={(e) => setPoiForm({ ...poiForm, description: e.target.value })}
                className="w-full rounded-xl border border-[#ECECEC] px-3.5 py-2.5"
              />
            </label>
            <Input
              label="Hours note"
              value={poiForm.hours_note}
              onChange={(e) => setPoiForm({ ...poiForm, hours_note: e.target.value })}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Menu URLs (one per line)</span>
              <textarea
                rows={2}
                value={poiForm.menu_urls}
                onChange={(e) => setPoiForm({ ...poiForm, menu_urls: e.target.value })}
                className="w-full rounded-xl border border-[#ECECEC] px-3.5 py-2.5 font-mono text-sm"
              />
            </label>
            <Input
              label="Sort order"
              type="number"
              value={poiForm.sort_order}
              onChange={(e) => setPoiForm({ ...poiForm, sort_order: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={poiForm.is_published}
                onChange={(e) => setPoiForm({ ...poiForm, is_published: e.target.checked })}
              />
              Published
            </label>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Photo</span>
              <input type="file" accept="image/*" onChange={(e) => setPoiImageFile(e.target.files?.[0] ?? null)} />
            </div>
            {poiFormError ? <p className="text-sm text-red-600">{poiFormError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
