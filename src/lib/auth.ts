const STAFF_EMAIL_DOMAIN = '@staff.invite.app'

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${STAFF_EMAIL_DOMAIN}`
}
