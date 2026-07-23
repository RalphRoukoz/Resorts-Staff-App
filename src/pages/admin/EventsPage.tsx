import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { PERMISSIONS } from '../../lib/permissions'
import { formatDateTime } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { ResortEvent, ResortMapPoi } from '../../types/database'

const GUEST_BUCKET = 'resort-guest'

type EventForm = {
  title: string
  description: string
  starts_at: string
  ends_at: string
  location_label: string
  poi_id: string
  is_published: boolean
  cover_url: string | null
}

const emptyForm = (): EventForm => ({
  title: '',
  description: '',
  starts_at: '',
  ends_at: '',
  location_label: '',
  poi_id: '',
  is_published: false,
  cover_url: null,
})

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function EventsPage() {
  const { t } = useTranslation()
  const { resortId, hasPermission, resort } = useAuth()
  const canWrite = hasPermission(PERMISSIONS.EVENTS_WRITE) || hasPermission(PERMISSIONS.ANNOUNCEMENTS_WRITE)
  const eventsEnabled = resort?.events_enabled === true

  const [events, setEvents] = useState<ResortEvent[]>([])
  const [pois, setPois] = useState<ResortMapPoi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EventForm>(emptyForm())
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const [eventsRes, poisRes] = await Promise.all([
      supabase
        .from('resort_events')
        .select(
          'id, resort_id, title, description, cover_url, starts_at, ends_at, location_label, poi_id, is_published, created_at, updated_at',
        )
        .eq('resort_id', resortId)
        .order('starts_at', { ascending: false })
        .limit(200),
      supabase
        .from('resort_map_pois')
        .select('id, title')
        .eq('resort_id', resortId)
        .order('sort_order'),
    ])

    if (eventsRes.error) setError(eventsRes.error.message)
    else setEvents((eventsRes.data ?? []) as ResortEvent[])

    if (!poisRes.error) setPois((poisRes.data ?? []) as ResortMapPoi[])

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setCoverFile(null)
    setFormError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setModalOpen(true)
  }

  function openEdit(item: ResortEvent) {
    setEditingId(item.id)
    setForm({
      title: item.title,
      description: item.description ?? '',
      starts_at: toLocalInput(item.starts_at),
      ends_at: toLocalInput(item.ends_at),
      location_label: item.location_label ?? '',
      poi_id: item.poi_id ?? '',
      is_published: item.is_published,
      cover_url: item.cover_url,
    })
    setCoverFile(null)
    setFormError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setModalOpen(true)
  }

  async function handleSave() {
    if (!resortId || !form.title.trim() || !form.starts_at) {
      setFormError('Title and start time are required')
      return
    }

    setSaving(true)
    setFormError(null)

    try {
      let coverUrl = form.cover_url
      if (coverFile) {
        const ext = coverFile.name.split('.').pop() || 'jpg'
        const path = `${resortId}/events/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from(GUEST_BUCKET)
          .upload(path, coverFile, { contentType: coverFile.type })
        if (uploadError) throw uploadError
        const { data } = supabase.storage.from(GUEST_BUCKET).getPublicUrl(path)
        coverUrl = data.publicUrl
      }

      const payload = {
        resort_id: resortId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        location_label: form.location_label.trim() || null,
        poi_id: form.poi_id || null,
        is_published: form.is_published,
        cover_url: coverUrl,
      }

      if (editingId) {
        const { error: updateError } = await supabase.from('resort_events').update(payload).eq('id', editingId)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase.from('resort_events').insert(payload)
        if (insertError) throw insertError
      }

      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    }
    setSaving(false)
  }

  async function handleDelete(item: ResortEvent) {
    if (!confirm(`Delete event "${item.title}"?`)) return
    const { error: deleteError } = await supabase.from('resort_events').delete().eq('id', item.id)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  if (!eventsEnabled) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('events.title')}</h2>
        <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('events.disabledHint')}
        </p>
      </div>
    )
  }

  if (loading) return <Spinner label={t('events.loading')} />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('events.title')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('events.subtitle')}</p>
        </div>
        {canWrite ? <Button onClick={openCreate}>{t('events.add')}</Button> : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="space-y-3">
        {events.map((item) => (
          <div key={item.id} className="flex flex-wrap gap-4 rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
            {item.cover_url ? (
              <img src={item.cover_url} alt="" className="h-20 w-20 rounded-xl object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-medium text-[#1A1A1A]">{item.title}</h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    item.is_published ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {item.is_published ? t('events.published') : t('events.draft')}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">{formatDateTime(item.starts_at)}</p>
              {item.location_label ? (
                <p className="text-sm text-gray-500">{item.location_label}</p>
              ) : null}
            </div>
            {canWrite ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => openEdit(item)}>
                  {t('events.edit')}
                </Button>
                <Button variant="danger" onClick={() => void handleDelete(item)}>
                  Delete
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        {events.length === 0 ? (
          <p className="rounded-2xl border border-[#ECECEC] bg-white px-4 py-12 text-center text-gray-400 shadow-sm">
            {t('events.empty')}
          </p>
        ) : null}
      </div>

      {modalOpen && canWrite ? (
        <Modal
          title={editingId ? t('events.edit') : t('events.add')}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label={t('events.fieldTitle')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">{t('events.fieldDescription')}</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-xl border border-[#ECECEC] px-3.5 py-2.5"
              />
            </label>
            <Input
              label={t('events.fieldStarts')}
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
            />
            <Input
              label={t('events.fieldEnds')}
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
            />
            <Input
              label={t('events.fieldLocation')}
              value={form.location_label}
              onChange={(e) => setForm({ ...form, location_label: e.target.value })}
            />
            {pois.length > 0 ? (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">{t('events.fieldPoi')}</span>
                <select
                  className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5"
                  value={form.poi_id}
                  onChange={(e) => setForm({ ...form, poi_id: e.target.value })}
                >
                  <option value="">—</option>
                  {pois.map((poi) => (
                    <option key={poi.id} value={poi.id}>
                      {poi.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_published}
                onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
              />
              {t('events.published')}
            </label>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-700">{t('events.fieldCover')}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
