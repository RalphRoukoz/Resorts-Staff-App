const E164_REGEX = /^\+[1-9]\d{1,14}$/

export function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone.trim())
}

export function formatPhoneError(): string {
  return 'Phone must be E.164 format (e.g. +96170123456)'
}
