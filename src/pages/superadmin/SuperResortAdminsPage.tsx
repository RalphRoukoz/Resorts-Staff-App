import { useEffect, useState } from 'react'
import { Spinner } from '../../components/ui/Spinner'
import { StaffManager } from '../../components/StaffManager'
import { supabase } from '../../lib/supabase'
import type { Resort } from '../../types/database'

export function SuperResortAdminsPage() {
  const [resorts, setResorts] = useState<Resort[]>([])
  const [selectedResortId, setSelectedResortId] = useState<string>('')
  const [loadingResorts, setLoadingResorts] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoadingResorts(true)
      const { data, error: fetchError } = await supabase.from('resorts').select('*').order('name')

      if (fetchError) setError(fetchError.message)
      else {
        const rows = (data ?? []) as Resort[]
        setResorts(rows)
        if (rows.length > 0) setSelectedResortId(rows[0].id)
      }
      setLoadingResorts(false)
    }
    void load()
  }, [])

  if (loadingResorts) return <Spinner label="Loading resorts…" />

  const resortPicker = (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700">Resort</span>
      <select
        className="rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
        value={selectedResortId}
        onChange={(e) => setSelectedResortId(e.target.value)}
      >
        {resorts.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div>
      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}
      <StaffManager
        resortId={selectedResortId || null}
        role="admin"
        headerControl={resortPicker}
      />
    </div>
  )
}
