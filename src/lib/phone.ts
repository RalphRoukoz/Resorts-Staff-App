// Phone handling for the staff app.
//
// Stored / RPC format: E.164 DIGITS WITH NO LEADING "+" (e.g. 96179400020).
// This matches how Supabase Auth stores OTP phone numbers, so the values line
// up across invitations, tenancies, assets, and the auth.users table.
//
// Default country is Lebanon (+961). The UI shows "+961"; the user types the
// local part. Pasting a full "+961…" or "961…" number also works.

const DEFAULT_COUNTRY_CODE = '961'

/**
 * Normalize any user-entered phone into E.164 digits with NO leading "+".
 * - strips a leading "+"
 * - keeps digits only
 * - strips a leading "0" from the local part
 * - prepends the default country code when the user typed a local number
 */
export function normalizePhone(input: string): string {
  if (!input) return ''

  const trimmed = input.trim()
  const hadPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (!digits) return ''

  // Full international number was provided (with "+") — just drop the "+".
  if (hadPlus) return digits

  // Already prefixed with the Lebanon country code.
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) return digits

  // Local part: strip a single leading "0", then prepend the country code.
  return DEFAULT_COUNTRY_CODE + digits.replace(/^0/, '')
}

/** Validate by checking the normalized value is 8–15 digits (E.164 max is 15). */
export function isValidPhone(input: string): boolean {
  return /^\d{8,15}$/.test(normalizePhone(input))
}

export const PHONE_ERROR = 'Enter a valid phone number (e.g. 79 400 020 or +961 79 400 020)'

/** Display a stored phone (no "+") as a readable international number. */
export function displayPhone(stored: string | null | undefined): string {
  if (!stored) return '—'
  return stored.startsWith('+') ? stored : `+${stored}`
}
