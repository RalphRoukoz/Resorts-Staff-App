import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizePhone } from '../lib/phone'
import { supabase } from '../lib/supabase'
import type { AssetType } from '../types/database'

interface UnitOption {
  id: string
  label: string
  asset_type: AssetType
}

interface UnitSearchSelectProps {
  resortId: string
  value: string
  onChange: (assetId: string, option?: UnitOption) => void
  /** Called after a unit is picked from the dropdown */
  onSelect?: (option: UnitOption) => void
  /** Pre-selected label when value is set but not in current results */
  selectedLabel?: string
}

/**
 * Searchable unit picker — loads at most 20 matches instead of every asset.
 */
export function UnitSearchSelect({ resortId, value, onChange, onSelect, selectedLabel }: UnitSearchSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [term, setTerm] = useState(selectedLabel ?? '')
  const [options, setOptions] = useState<UnitOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [open])

  const search = useCallback(
    async (query: string) => {
      if (!resortId) return
      setLoading(true)

      let q = supabase
        .from('assets')
        .select('id, label, asset_type')
        .eq('resort_id', resortId)
        .order('label')
        .limit(20)

      const trimmed = query.trim()
      if (trimmed) {
        const filters = [`label.ilike.%${trimmed}%`, `owner_phone.ilike.%${trimmed}%`]
        const normalized = normalizePhone(trimmed)
        if (normalized) filters.push(`owner_phones.cs.{${normalized}}`)
        q = q.or(filters.join(','))
      }

      const { data } = await q
      setOptions((data ?? []) as UnitOption[])
      setLoading(false)
    },
    [resortId],
  )

  useEffect(() => {
    if (open) void search(term)
  }, [open, term, search])

  function pick(option: UnitOption) {
    onChange(option.id, option)
    setTerm(`${option.label} (${option.asset_type})`)
    setOpen(false)
    onSelect?.(option)
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] placeholder:text-gray-400 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
        placeholder="Search by label or phone…"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {open ? (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-[#ECECEC] bg-white py-1 shadow-md">
          {loading ? (
            <li className="px-3 py-2 text-sm text-gray-400">Searching…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">No units found</li>
          ) : (
            options.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${opt.id === value ? 'bg-gray-50 font-medium' : ''}`}
                  onClick={() => pick(opt)}
                >
                  {opt.label}{' '}
                  <span className="text-gray-400">({opt.asset_type})</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
