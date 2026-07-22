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
    // PostgREST uuid cast failures show up as 22P02 / invalid input syntax
    const msg = error.message || 'UNKNOWN'
    if (/uuid|22P02|invalid input syntax/i.test(msg)) {
      return { ok: false, reason: 'EMPTY_TOKEN' }
    }
    return { ok: false, reason: msg }
  }

  if (data == null || typeof data !== 'object') {
    return { ok: false, reason: 'UNKNOWN' }
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

export async function scanOrValidate(
  token: string,
  checkpoint: ScanCheckpoint,
): Promise<ValidateResult> {
  const result = await scanInvitation(token, checkpoint)

  // Back-compat: older scan_invitation returned RECEPTION_NOT_REQUIRED for chalet single-scan.
  if (
    !result.ok &&
    result.reason === 'RECEPTION_NOT_REQUIRED' &&
    checkpoint === 'reception'
  ) {
    return scanInvitation(token, 'gate')
  }

  return result
}
