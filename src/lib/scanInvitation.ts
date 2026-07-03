import { supabase } from './supabase'
import type { ScanCheckpoint, ValidateResult } from '../types/database'

export async function scanInvitation(
  token: string,
  checkpoint: ScanCheckpoint,
): Promise<ValidateResult> {
  const { data, error } = await supabase.rpc('scan_invitation', {
    p_token: token,
    p_checkpoint: checkpoint,
  })

  if (error) {
    return { ok: false, reason: error.message }
  }

  const row = data as Record<string, unknown>
  if (row.ok === true) {
    return {
      ok: true,
      invitee: String(row.invitee ?? ''),
      chalet: String(row.chalet ?? ''),
      resort: String(row.resort ?? ''),
      visit_date: String(row.visit_date ?? ''),
      checkpoint: row.checkpoint as ScanCheckpoint | undefined,
      next_checkpoint: row.next_checkpoint as ScanCheckpoint | undefined,
      final: row.final === true,
    }
  }

  return {
    ok: false,
    reason: String(row.reason ?? 'UNKNOWN'),
    validated_at: row.validated_at ? String(row.validated_at) : undefined,
    invitee: row.invitee ? String(row.invitee) : undefined,
    chalet: row.chalet ? String(row.chalet) : undefined,
    valid_for: row.valid_for ? String(row.valid_for) : undefined,
  }
}

/** Legacy single-step validation when scan_invitation is unavailable. */
export async function validateInvitationLegacy(token: string): Promise<ValidateResult> {
  const { data, error } = await supabase.rpc('validate_invitation', { p_token: token })
  if (error) return { ok: false, reason: error.message }
  return data as ValidateResult
}

export async function scanOrValidate(
  token: string,
  checkpoint: ScanCheckpoint,
): Promise<ValidateResult> {
  const result = await scanInvitation(token, checkpoint)
  // Simple-flow resorts: reception desk may scan when no reception step is configured.
  if (
    !result.ok &&
    result.reason === 'RECEPTION_NOT_REQUIRED' &&
    checkpoint === 'reception'
  ) {
    return validateInvitationLegacy(token)
  }
  return result
}
