export function extractInvitationToken(decodedText: string): string {
  const trimmed = decodedText.trim()
  const marker = '/i/'
  const markerIndex = trimmed.indexOf(marker)

  if (markerIndex !== -1) {
    const after = trimmed.slice(markerIndex + marker.length)
    return after.split(/[/?#]/)[0]
  }

  return trimmed
}
