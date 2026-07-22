/** Strip query/hash fragments from a path or token segment. */
function firstSegment(value: string): string {
  return value.split(/[/?#&]/)[0]
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Normalize scanned payloads (BOM / zero-width / wrapping quotes). */
function cleanPayload(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
}

function asUuid(candidate: string): string | null {
  const value = firstSegment(cleanPayload(candidate))
  if (UUID_RE.test(value)) return value.toLowerCase()
  // Sometimes cameras insert spaces or uppercase; already lowercased above path
  const compact = value.replace(/\s+/g, '')
  if (UUID_RE.test(compact)) return compact.toLowerCase()
  return null
}

/**
 * Extract the invitation token from a scanned QR payload.
 * Owner apps may encode a bare token, a deep link (`…/i/{token}`), or a URL with query params.
 * Returns empty string when no UUID-like token can be recovered (caller treats as EMPTY_TOKEN).
 */
export function extractInvitationToken(decodedText: string): string {
  const trimmed = cleanPayload(decodedText)
  if (!trimmed) return ''

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      for (const key of ['token', 'invitation_token', 'invite_token', 'inviteToken']) {
        const value = parsed[key]
        if (typeof value === 'string') {
          const uuid = asUuid(value)
          if (uuid) return uuid
        }
      }
    } catch {
      // not JSON — continue
    }
  }

  const marker = '/i/'
  const markerIndex = trimmed.toLowerCase().indexOf(marker)
  if (markerIndex !== -1) {
    const uuid = asUuid(trimmed.slice(markerIndex + marker.length))
    if (uuid) return uuid
  }

  if (trimmed.includes('://') || trimmed.startsWith('/')) {
    try {
      const url = new URL(trimmed.includes('://') ? trimmed : `https://local${trimmed}`)
      for (const key of ['token', 't', 'invite']) {
        const query = url.searchParams.get(key)
        if (query) {
          const uuid = asUuid(query)
          if (uuid) return uuid
        }
      }
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        const segment = parts[parts.length - 1]
        const parent = parts[parts.length - 2]
        if (segment && /^(i|invite|invitation|invitations)$/i.test(parent)) {
          const uuid = asUuid(segment)
          if (uuid) return uuid
        }
      }
      // Last path segment alone may be the UUID
      const last = parts[parts.length - 1]
      if (last) {
        const uuid = asUuid(last)
        if (uuid) return uuid
      }
    } catch {
      // not a URL — fall through
    }
  }

  return asUuid(trimmed) ?? ''
}
