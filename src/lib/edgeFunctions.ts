import { supabase } from './supabase'

export type StaffAccountPayload = {
  username: string
  password: string
  role: 'admin' | 'reception'
  resort_id: string
}

const ERROR_MESSAGES: Record<string, string> = {
  BAD_INPUT: 'Missing or invalid fields.',
  NOT_AUTHENTICATED: 'Your session expired — please sign in again.',
  FORBIDDEN: 'You do not have permission to create this account type.',
  METHOD_NOT_ALLOWED: 'Unexpected request method.',
}

/**
 * Calls create-staff-account and returns either { ok: true } or { ok: false, message: string }.
 * Handles both HTTP-level errors (non-2xx) and application-level { error: string } bodies.
 */
export async function createStaffAccount(
  payload: StaffAccountPayload,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.functions.invoke('create-staff-account', {
    body: payload,
  })

  if (error) {
    // Try to extract a structured error body from the HTTP error response
    let bodyError: string | undefined
    try {
      // FunctionsHttpError exposes the raw Response on .context
      const ctx = (error as { context?: Response }).context
      if (ctx?.json) {
        const parsed = (await ctx.json()) as { error?: string }
        bodyError = parsed.error
      }
    } catch {
      // ignore parse failure
    }

    const code = bodyError ?? ''
    const message = ERROR_MESSAGES[code] ?? bodyError ?? error.message
    return { ok: false, message }
  }

  // 200 OK but the function returned { error: ... } in the body
  if (data && typeof data === 'object' && 'error' in data) {
    const code = String((data as { error: string }).error)
    return { ok: false, message: ERROR_MESSAGES[code] ?? code }
  }

  return { ok: true }
}

const RESET_ERROR_MESSAGES: Record<string, string> = {
  BAD_INPUT: 'Password must be at least 6 characters.',
  NOT_AUTHENTICATED: 'Your session expired — please sign in again.',
  FORBIDDEN: 'You do not have permission to reset this account.',
  METHOD_NOT_ALLOWED: 'Unexpected request method.',
}

/**
 * Calls reset-staff-password. Passwords can only be set, never read back.
 * Returns { ok: true } or { ok: false, message: string }.
 */
export async function resetStaffPassword(
  staffUserId: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.functions.invoke('reset-staff-password', {
    body: { staff_user_id: staffUserId, new_password: newPassword },
  })

  if (error) {
    let bodyError: string | undefined
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx?.json) {
        const parsed = (await ctx.json()) as { error?: string }
        bodyError = parsed.error
      }
    } catch {
      // ignore parse failure
    }

    const code = bodyError ?? ''
    const message = RESET_ERROR_MESSAGES[code] ?? bodyError ?? error.message
    return { ok: false, message }
  }

  if (data && typeof data === 'object' && 'error' in data) {
    const code = String((data as { error: string }).error)
    return { ok: false, message: RESET_ERROR_MESSAGES[code] ?? code }
  }

  return { ok: true }
}
