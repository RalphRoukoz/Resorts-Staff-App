/** Strip query/hash fragments from a path or token segment. */
function firstSegment(value: string): string {
  return value.split(/[/?#&]/)[0]
}

/**
 * Extract the invitation token from a scanned QR payload.
 * Owner apps may encode a bare token, a deep link (`…/i/{token}`), or a URL with query params.
 */
export function extractInvitationToken(decodedText: string): string {
  const trimmed = decodedText.trim()
  if (!trimmed) return trimmed

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      for (const key of ['token', 'invitation_token', 'invite_token', 'inviteToken']) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
    } catch {
      // not JSON — continue
    }
  }

  const marker = '/i/'
  const markerIndex = trimmed.indexOf(marker)
  if (markerIndex !== -1) {
    return firstSegment(trimmed.slice(markerIndex + marker.length))
  }

  if (trimmed.includes('://') || trimmed.startsWith('/')) {
    try {
      const url = new URL(trimmed.includes('://') ? trimmed : `https://local${trimmed}`)
      for (const key of ['token', 't', 'invite']) {
        const query = url.searchParams.get(key)
        if (query?.trim()) return firstSegment(query.trim())
      }
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        const segment = parts[parts.length - 1]
        const parent = parts[parts.length - 2]
        if (segment && /^(i|invite|invitation|invitations)$/i.test(parent)) {
          return firstSegment(segment)
        }
      }
    } catch {
      // not a URL — fall through
    }
  }

  return trimmed
}
