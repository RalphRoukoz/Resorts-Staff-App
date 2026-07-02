import { supabase } from './supabase'

export type StaffAccountPayload = {
  username: string
  password: string
  role: 'admin' | 'reception' | 'viewer'
  resort_id: string
}

type EdgeResult = { ok: true } | { ok: false; message: string }

/**
 * Invokes an edge function and normalizes its outcome to { ok } | { ok, message }.
 * Handles HTTP-level errors (non-2xx) and application-level { error: code } bodies,
 * mapping known codes to friendly messages.
 */
async function invokeEdge(
  name: string,
  body: Record<string, unknown>,
  messages: Record<string, string>,
): Promise<EdgeResult> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
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
    return { ok: false, message: messages[code] ?? bodyError ?? error.message }
  }

  // 200 OK but the function returned { error: ... } in the body
  if (data && typeof data === 'object' && 'error' in data) {
    const code = String((data as { error: string }).error)
    return { ok: false, message: messages[code] ?? code }
  }

  return { ok: true }
}

export function createStaffAccount(payload: StaffAccountPayload): Promise<EdgeResult> {
  return invokeEdge('create-staff-account', payload, {
    BAD_INPUT: 'Missing or invalid fields.',
    NOT_AUTHENTICATED: 'Your session expired — please sign in again.',
    FORBIDDEN: 'You do not have permission to create this account type.',
    METHOD_NOT_ALLOWED: 'Unexpected request method.',
  })
}

export function resetStaffPassword(staffUserId: string, newPassword: string): Promise<EdgeResult> {
  return invokeEdge(
    'reset-staff-password',
    { staff_user_id: staffUserId, new_password: newPassword },
    {
      BAD_INPUT: 'Password must be at least 6 characters.',
      NOT_AUTHENTICATED: 'Your session expired — please sign in again.',
      FORBIDDEN: 'You do not have permission to reset this account.',
      METHOD_NOT_ALLOWED: 'Unexpected request method.',
    },
  )
}
