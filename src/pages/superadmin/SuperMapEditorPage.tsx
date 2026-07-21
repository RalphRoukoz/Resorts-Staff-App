import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { MapPoiInspector } from '../../components/map/MapPoiInspector'
import { supabase } from '../../lib/supabase'
import type { PoiType, ResortMapPoi } from '../../types/database'
const GUEST_BUCKET = 'resort-guest'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const POI_META = {
  restaurant: 'Restaurant',
  sports: 'Sports court',
  playground: 'Playground',
  pool: 'Pool',
  beach: 'Beach',
  other: 'Other',
} satisfies Record<PoiType, string>

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
const emptyPoiForm = (type: PoiType = 'restaurant'): PoiForm => ({
  poi_type: type,
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
function pointFromClient(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)) * 100) / 100,
    y: Math.round(Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)) * 100) / 100,
  }
}
function validateImage(file: File) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return 'Use a JPEG, PNG, WebP, or GIF image.'
  if (file.size > MAX_IMAGE_BYTES) return 'Image must be smaller than 5 MB.'
  return null
}
function PoiMarkerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z" fill="currentColor" />
      <circle cx="12" cy="9" r="2.5" fill="white" />
    </svg>
  )
}

export function SuperMapEditorPage() {
  const { resortId } = useParams<{ resortId: string }>()
  const [resortName, setResortName] = useState('')
  const [mapEnabled, setMapEnabled] = useState(false)
  const [mapImageUrl, setMapImageUrl] = useState<string | null>(null)
  const [pois, setPois] = useState<ResortMapPoi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapFile, setMapFile] = useState<File | null>(null)
  const [savingMap, setSavingMap] = useState(false)
  const [placingType, setPlacingType] = useState<PoiType | null>(null)
  const [editingPoiId, setEditingPoiId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [poiForm, setPoiForm] = useState<PoiForm>(emptyPoiForm())
  const [poiImageFile, setPoiImageFile] = useState<File | null>(null)
  const [poiFormError, setPoiFormError] = useState<string | null>(null)
  const [savingPoi, setSavingPoi] = useState(false)
  const [draggingPoiId, setDraggingPoiId] = useState<string | null>(null)
  const mapInputRef = useRef<HTMLInputElement>(null)
  const mapCanvasRef = useRef<HTMLDivElement>(null)
  const dragMovedRef = useRef(false)

  const mapPreviewUrl = useMemo(() => (mapFile ? URL.createObjectURL(mapFile) : null), [mapFile])
  const poiPreviewUrl = useMemo(
    () => (poiImageFile ? URL.createObjectURL(poiImageFile) : poiForm.image_url),
    [poiImageFile, poiForm.image_url],
  )
  const displayedMapUrl = mapPreviewUrl ?? mapImageUrl

  useEffect(() => () => {
    if (mapPreviewUrl) URL.revokeObjectURL(mapPreviewUrl)
    if (poiImageFile && poiPreviewUrl) URL.revokeObjectURL(poiPreviewUrl)
  }, [mapPreviewUrl, poiImageFile, poiPreviewUrl])

  const load = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)
    const [resortRes, poisRes] = await Promise.all([
      supabase.from('resorts').select('name, map_enabled, map_image_url').eq('id', resortId).single(),
      supabase.from('resort_map_pois').select('*').eq('resort_id', resortId).order('sort_order'),
    ])
    if (resortRes.error) setError(resortRes.error.message)
    else {
      const resort = resortRes.data as { name: string; map_enabled: boolean; map_image_url: string | null }
      setResortName(resort.name)
      setMapEnabled(resort.map_enabled)
      setMapImageUrl(resort.map_image_url)
    }
    if (poisRes.error) setError(poisRes.error.message)
    else setPois((poisRes.data ?? []) as ResortMapPoi[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function uploadGuestFile(file: File, subfolder: string) {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${resortId}/${subfolder}/${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from(GUEST_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type })
    if (uploadError) throw uploadError
    return supabase.storage.from(GUEST_BUCKET).getPublicUrl(path).data.publicUrl
  }

  function selectMapFile(file: File | null) {
    if (!file) return
    const validationError = validateImage(file)
    if (validationError) {
      setError(validationError)
      if (mapInputRef.current) mapInputRef.current.value = ''
      return
    }
    setError(null)
    setMapFile(file)
  }

  async function handleSaveMapImage() {
    if (!resortId || !mapFile) return
    setSavingMap(true)
    setError(null)
    try {
      const url = await uploadGuestFile(mapFile, 'map')
      const { error: updateError } = await supabase.from('resorts').update({ map_image_url: url }).eq('id', resortId)
      if (updateError) throw updateError
      setMapImageUrl(url)
      setMapFile(null)
      if (mapInputRef.current) mapInputRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Map upload failed. Check the file and try again.')
    } finally {
      setSavingMap(false)
    }
  }

  async function toggleMapEnabled() {
    if (!resortId) return
    const next = !mapEnabled
    const { error: updateError } = await supabase.from('resorts').update({ map_enabled: next }).eq('id', resortId)
    if (updateError) setError(updateError.message)
    else setMapEnabled(next)
  }

  function openCreatePoi(x = 50, y = 50, type: PoiType = placingType ?? 'restaurant') {
    setEditingPoiId(null)
    setPoiForm({ ...emptyPoiForm(type), x_pct: String(x), y_pct: String(y) })
    setPoiImageFile(null)
    setPoiFormError(null)
    setInspectorOpen(true)
    setPlacingType(null)
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
    setInspectorOpen(true)
  }

  function placeAt(clientX: number, clientY: number, type: PoiType) {
    if (!mapCanvasRef.current) return
    const point = pointFromClient(mapCanvasRef.current, clientX, clientY)
    openCreatePoi(point.x, point.y, type)
  }

  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!placingType || draggingPoiId) return
    placeAt(event.clientX, event.clientY, placingType)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/x-resort-poi') as PoiType
    if (type && type in POI_META) placeAt(event.clientX, event.clientY, type)
  }

  function movePoi(event: React.PointerEvent<HTMLButtonElement>, poi: ResortMapPoi) {
    if (!mapCanvasRef.current || draggingPoiId !== poi.id) return
    const point = pointFromClient(mapCanvasRef.current, event.clientX, event.clientY)
    dragMovedRef.current = true
    setPois((current) => current.map((item) => item.id === poi.id ? { ...item, x_pct: point.x, y_pct: point.y } : item))
  }

  async function finishMove(event: React.PointerEvent<HTMLButtonElement>, poi: ResortMapPoi) {
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDraggingPoiId(null)
    if (dragMovedRef.current) {
      const point = mapCanvasRef.current
        ? pointFromClient(mapCanvasRef.current, event.clientX, event.clientY)
        : { x: Number(poi.x_pct), y: Number(poi.y_pct) }
      const { error: moveError } = await supabase
        .from('resort_map_pois')
        .update({ x_pct: point.x, y_pct: point.y })
        .eq('id', poi.id)
      if (moveError) {
        setError(moveError.message)
        await load()
      } else if (editingPoiId === poi.id) {
        setPoiForm((form) => ({ ...form, x_pct: String(point.x), y_pct: String(point.y) }))
      }
    } else {
      openEditPoi(poi)
    }
  }

  async function handleSavePoi() {
    if (!resortId || !poiForm.title.trim()) {
      setPoiFormError('Add a title for this place.')
      return
    }
    const x = Math.min(100, Math.max(0, Number(poiForm.x_pct)))
    const y = Math.min(100, Math.max(0, Number(poiForm.y_pct)))
    setSavingPoi(true)
    setPoiFormError(null)
    try {
      let imageUrl = poiForm.image_url
      if (poiImageFile) {
        const validationError = validateImage(poiImageFile)
        if (validationError) throw new Error(validationError)
        imageUrl = await uploadGuestFile(poiImageFile, 'pois')
      }
      const payload = {
        resort_id: resortId,
        poi_type: poiForm.poi_type,
        title: poiForm.title.trim(),
        description: poiForm.description.trim() || null,
        hours_note: poiForm.hours_note.trim() || null,
        x_pct: x,
        y_pct: y,
        sort_order: Number(poiForm.sort_order) || 0,
        is_published: poiForm.is_published,
        image_url: imageUrl,
        menu_urls: poiForm.menu_urls.split('\n').map((value) => value.trim()).filter(Boolean),
      }
      const query = editingPoiId
        ? supabase.from('resort_map_pois').update(payload).eq('id', editingPoiId)
        : supabase.from('resort_map_pois').insert(payload)
      const { error: saveError } = await query
      if (saveError) throw saveError
      setInspectorOpen(false)
      await load()
    } catch (e) {
      setPoiFormError(e instanceof Error ? e.message : 'Place could not be saved.')
    } finally {
      setSavingPoi(false)
    }
  }

  async function handleDeletePoi() {
    const poi = pois.find((item) => item.id === editingPoiId)
    if (!poi || !confirm(`Delete "${poi.title}"?`)) return
    const { error: deleteError } = await supabase.from('resort_map_pois').delete().eq('id', poi.id)
    if (deleteError) setError(deleteError.message)
    else {
      setInspectorOpen(false)
      await load()
    }
  }

  if (loading) return <Spinner label="Loading map editor…" />

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/superadmin/resorts" className="text-sm font-medium text-[var(--accent)] hover:opacity-80">
            ← Back to resorts
          </Link>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#1A1A1A]">Map editor — {resortName}</h2>
          <p className="mt-1 text-sm text-gray-500">Upload the resort map, then drag place types onto it.</p>
        </div>
        <button
          type="button"
          onClick={() => void toggleMapEnabled()}
          className={`min-h-11 rounded-xl border px-4 text-sm font-medium transition ${
            mapEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}
        >
          {mapEnabled ? 'Visible in guest app' : 'Map hidden from guests'}
        </button>
      </header>

      {error ? <p role="alert" className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

      <section className="mb-4 rounded-2xl border border-[#ECECEC] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-[#1A1A1A]">Map image</h3>
            <p className="mt-0.5 text-xs text-gray-500">JPEG, PNG, WebP or GIF · maximum 5 MB</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-xl border border-[#ECECEC] bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50">
              {displayedMapUrl ? 'Replace image' : 'Choose image'}
              <input
                ref={mapInputRef}
                type="file"
                accept={ALLOWED_IMAGE_TYPES.join(',')}
                onChange={(event) => selectMapFile(event.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            {mapFile ? (
              <>
                <Button variant="secondary" onClick={() => setMapFile(null)}>Cancel preview</Button>
                <Button onClick={() => void handleSaveMapImage()} disabled={savingMap}>
                  {savingMap ? 'Uploading…' : 'Save map image'}
                </Button>
              </>
            ) : null}
          </div>
        </div>
        {mapFile ? <p className="mt-3 text-sm font-medium text-amber-700">Previewing {mapFile.name} — save to publish this image.</p> : null}
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-[#ECECEC] bg-white p-4 shadow-sm">
            <div className="mb-3">
              <h3 className="font-medium text-[#1A1A1A]">Place toolbar</h3>
              <p className="mt-0.5 text-xs text-gray-500">Drag a type onto the map, or click a type then click the map.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(POI_META) as [PoiType, string][]).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  draggable={Boolean(displayedMapUrl)}
                  disabled={!displayedMapUrl}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-resort-poi', type)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => setPlacingType((current) => current === type ? null : type)}
                  className={`flex min-h-11 cursor-grab items-center gap-2 rounded-xl border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    placingType === type ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[#ECECEC] bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                  aria-pressed={placingType === type}
                >
                  <PoiMarkerIcon />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {displayedMapUrl ? (
            <div
              ref={mapCanvasRef}
              className={`relative overflow-hidden rounded-2xl border border-[#E4E4E4] bg-gray-100 shadow-sm ${
                placingType ? 'cursor-crosshair ring-2 ring-[var(--accent)]/30' : ''
              }`}
              onClick={handleMapClick}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDrop={handleDrop}
            >
              <img src={displayedMapUrl} alt={`${resortName} map`} className="block w-full select-none" draggable={false} />
              {pois.map((poi) => {
                const selected = editingPoiId === poi.id && inspectorOpen
                return (
                  <button
                    key={poi.id}
                    type="button"
                    className={`group absolute min-h-11 -translate-x-1/2 -translate-y-1/2 touch-none cursor-grab rounded-full focus:outline-none focus:ring-4 focus:ring-[var(--accent)]/30 ${
                      draggingPoiId === poi.id ? 'z-30 cursor-grabbing' : 'z-10'
                    }`}
                    style={{ left: `${poi.x_pct}%`, top: `${poi.y_pct}%` }}
                    aria-label={`${poi.title}. Drag to move or click to edit.`}
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragMovedRef.current = false
                      setDraggingPoiId(poi.id)
                    }}
                    onPointerMove={(event) => movePoi(event, poi)}
                    onPointerUp={(event) => void finishMove(event, poi)}
                    onPointerCancel={() => setDraggingPoiId(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') openEditPoi(poi)
                    }}
                  >
                    <span className={`flex h-11 w-11 items-center justify-center rounded-full border-2 border-white shadow-lg transition ${
                      selected ? 'scale-110 bg-[#1A1A1A] text-white' : 'bg-[var(--accent)] text-white group-hover:scale-105'
                    }`}>
                      <PoiMarkerIcon size={22} />
                    </span>
                    <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
                      {poi.title}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-white p-8 text-center">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" className="text-gray-300" aria-hidden>
                <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="m5.5 17 4.2-4.2 3 3 2.2-2.2L19 17.7" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="16.5" cy="8.5" r="1.5" fill="currentColor" />
              </svg>
              <h3 className="mt-4 font-medium text-[#1A1A1A]">Choose a resort map</h3>
              <p className="mt-1 max-w-sm text-sm text-gray-500">The image appears here immediately so you can check it before uploading.</p>
            </div>
          )}
        </div>

        <aside className="xl:sticky xl:top-6">
          {inspectorOpen ? (
            <MapPoiInspector
              form={poiForm}
              editing={Boolean(editingPoiId)}
              saving={savingPoi}
              error={poiFormError}
              imagePreviewUrl={poiPreviewUrl}
              acceptedImageTypes={ALLOWED_IMAGE_TYPES.join(',')}
              onChange={setPoiForm}
              onImageChange={setPoiImageFile}
              onClose={() => setInspectorOpen(false)}
              onSave={() => void handleSavePoi()}
              onDelete={() => void handleDeletePoi()}
            />
          ) : (
            <div className="rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
              <h3 className="font-medium text-[#1A1A1A]">Places ({pois.length})</h3>
              <p className="mt-1 text-sm text-gray-500">Click a marker or place below to edit it. Drag markers directly on the map to move them.</p>
              <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto">
                {pois.map((poi) => {
                  return (
                    <button
                      key={poi.id}
                      type="button"
                      onClick={() => openEditPoi(poi)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-[#ECECEC] p-3 text-left transition hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
                        <PoiMarkerIcon size={19} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[#1A1A1A]">{poi.title}</span>
                        <span className="block text-xs text-gray-500">{POI_META[poi.poi_type]}{!poi.is_published ? ' · Draft' : ''}</span>
                      </span>
                    </button>
                  )
                })}
                {pois.length === 0 ? <p className="py-6 text-center text-sm text-gray-400">No places added yet.</p> : null}
              </div>
              <Button fullWidth className="mt-4" disabled={!displayedMapUrl} onClick={() => openCreatePoi()}>Add place</Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
