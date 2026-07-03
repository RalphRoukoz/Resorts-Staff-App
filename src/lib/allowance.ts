import type { InviteAllowanceBucket } from '../types/database'

export function isAllowanceBucketEmpty(bucket: InviteAllowanceBucket | undefined): boolean {
  if (!bucket) return true
  return bucket.total === 0 && bucket.used === 0 && bucket.base === 0 && bucket.remaining === 0
}

export function formatAllowanceCell(
  bucket: InviteAllowanceBucket | undefined,
  noDataLabel: string,
  unlimitedLabel = 'Unlimited',
): string {
  if (!bucket) return noDataLabel
  if (bucket.total == null && bucket.remaining == null) return unlimitedLabel
  return `${bucket.remaining ?? 0} / ${bucket.total ?? 0}`
}

export function parseAllowanceBucket(raw: unknown): InviteAllowanceBucket | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const base = Number(o.base)
  const bonus = Number(o.bonus ?? 0)
  const used = Number(o.used ?? 0)
  if ([base, bonus, used].some((n) => Number.isNaN(n))) return null

  const totalRaw = o.total
  const total = totalRaw == null || Number.isNaN(Number(totalRaw))
    ? base + bonus
    : Number(totalRaw)

  const remainingRaw = o.remaining
  const remaining = remainingRaw == null || Number.isNaN(Number(remainingRaw))
    ? Math.max(total - used, 0)
    : Number(remainingRaw)

  const totalVal = o.total
  if (totalVal === null || totalVal === undefined || String(totalVal) === 'null') {
    return { base, bonus, total: null, used, remaining: null }
  }
  return { base, bonus, total, used, remaining }
}
