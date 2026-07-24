import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { PoiType } from '../../types/database'

export type MapPoiForm = {
  poi_type: PoiType
  title: string
  description: string
  hours_note: string
  x_pct: string
  y_pct: string
  sort_order: string
  is_published: boolean
  is_featured: boolean
  image_url: string | null
  menu_urls: string
}

const TYPE_LABELS: Record<PoiType, string> = {
  restaurant: 'Restaurant',
  sports: 'Sports court',
  playground: 'Playground',
  pool: 'Pool',
  beach: 'Beach',
  other: 'Other',
}

type Props = {
  form: MapPoiForm
  editing: boolean
  saving: boolean
  error: string | null
  imagePreviewUrl: string | null
  acceptedImageTypes: string
  onChange: (form: MapPoiForm) => void
  onImageChange: (file: File | null) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}

export function MapPoiInspector({
  form,
  editing,
  saving,
  error,
  imagePreviewUrl,
  acceptedImageTypes,
  onChange,
  onImageChange,
  onClose,
  onSave,
  onDelete,
}: Props) {
  return (
    <div className="rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            {editing ? 'Selected place' : 'New place'}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-[#1A1A1A]">
            {form.title || 'Place details'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-lg px-3 text-sm text-gray-500 hover:bg-gray-100"
        >
          Close
        </button>
      </div>

      <div className="space-y-4">
        <Input
          label="Title"
          value={form.title}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
        />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Type</span>
          <select
            className="min-h-11 w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5"
            value={form.poi_type}
            onChange={(event) => onChange({ ...form, poi_type: event.target.value as PoiType })}
          >
            {(Object.entries(TYPE_LABELS) as [PoiType, string][]).map(([type, label]) => (
              <option key={type} value={type}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Description</span>
          <textarea
            rows={4}
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            className="w-full rounded-xl border border-[#ECECEC] px-3.5 py-2.5"
          />
        </label>
        <Input
          label="Opening hours"
          value={form.hours_note}
          onChange={(event) => onChange({ ...form, hours_note: event.target.value })}
        />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">
            Menu links (one per line)
          </span>
          <textarea
            rows={2}
            value={form.menu_urls}
            onChange={(event) => onChange({ ...form, menu_urls: event.target.value })}
            className="w-full rounded-xl border border-[#ECECEC] px-3.5 py-2.5 font-mono text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="X position %"
            type="number"
            min="0"
            max="100"
            value={form.x_pct}
            onChange={(event) => onChange({ ...form, x_pct: event.target.value })}
          />
          <Input
            label="Y position %"
            type="number"
            min="0"
            max="100"
            value={form.y_pct}
            onChange={(event) => onChange({ ...form, y_pct: event.target.value })}
          />
        </div>
        <Input
          label="Sort order"
          type="number"
          value={form.sort_order}
          onChange={(event) => onChange({ ...form, sort_order: event.target.value })}
        />
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[#ECECEC] px-3 text-sm">
          <input
            type="checkbox"
            checked={form.is_published}
            onChange={(event) => onChange({ ...form, is_published: event.target.checked })}
          />
          Visible in guest app
        </label>
        <label className="flex min-h-11 items-start gap-3 rounded-xl border border-[#ECECEC] px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.is_featured}
            onChange={(event) =>
              onChange({
                ...form,
                is_featured: event.target.checked,
                is_published: event.target.checked ? true : form.is_published,
              })
            }
          />
          <span>
            <span className="block font-medium text-gray-800">Featured on Explore</span>
            <span className="mt-0.5 block text-xs text-gray-500">
              Shows as the featured place on the guest Explore home. Only one place per resort.
            </span>
          </span>
        </label>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Place photo</span>
          {imagePreviewUrl ? (
            <img
              src={imagePreviewUrl}
              alt=""
              className="mb-2 aspect-[16/9] w-full rounded-xl object-cover"
            />
          ) : null}
          <input
            type="file"
            accept={acceptedImageTypes}
            onChange={(event) => onImageChange(event.target.files?.[0] ?? null)}
            className="w-full text-sm text-gray-500"
          />
        </div>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save place'}
          </Button>
          {editing ? <Button variant="danger" onClick={onDelete}>Delete</Button> : null}
        </div>
      </div>
    </div>
  )
}
