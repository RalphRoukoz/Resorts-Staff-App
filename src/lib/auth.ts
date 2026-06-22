const STAFF_EMAIL_DOMAIN = '@staff.invite.app'

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${STAFF_EMAIL_DOMAIN}`
}

export function emailToUsername(email: string | null | undefined): string {
  if (!email) return 'Unknown'
  return email.replace(STAFF_EMAIL_DOMAIN, '')
}
