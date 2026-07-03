export function formatPersonName(first?: string | null, last?: string | null, emptyLabel = '—'): string {
  const parts = [first?.trim(), last?.trim()].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : emptyLabel
}
