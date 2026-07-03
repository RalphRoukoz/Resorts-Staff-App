export type AnnouncementExpiryPreset =
  | 'never'
  | '1d'
  | '3d'
  | '7d'
  | '14d'
  | '30d'
  | 'custom'

const PRESET_MS: Record<Exclude<AnnouncementExpiryPreset, 'never' | 'custom'>, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

export function computeAnnouncementExpiresAt(
  preset: AnnouncementExpiryPreset,
  customLocalDateTime: string,
  from: Date = new Date(),
): string | null {
  if (preset === 'never') return null
  if (preset === 'custom') {
    if (!customLocalDateTime.trim()) return null
    const at = new Date(customLocalDateTime)
    if (Number.isNaN(at.getTime())) return null
    return at.toISOString()
  }
  return new Date(from.getTime() + PRESET_MS[preset]).toISOString()
}

export function isAnnouncementExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= now.getTime()
}

export const EXPIRY_PRESET_LABELS: Record<AnnouncementExpiryPreset, string> = {
  never: 'Never',
  '1d': '1 day',
  '3d': '3 days',
  '7d': '7 days',
  '14d': '14 days',
  '30d': '30 days',
  custom: 'Custom date & time',
}
