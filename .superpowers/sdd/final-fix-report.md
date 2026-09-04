# Final branch review fixes

## 2026-09-05 — Important findings

- Added `20260905123000_fix_allowance_remaining_semantics.sql` additively in both repositories; the previously applied `20260905121000` and `20260905122000` migrations were not rewritten.
- Pulled the deployed `asset_invite_allowance(uuid)`, `remaining_invites(uuid,text,date)`, and `adjust_asset_invite_quota(uuid,integer,integer,text)` definitions with `pg_get_functiondef` before editing.
- Restored automatic-mode per-asset weekday/weekend limits with resort-type fallback.
- Restored unlimited automatic cabines when `cabine_limit_invites = false`; allowance returns the historical unlimited JSON shape plus the current `quota_mode` / `handed` keys, and `remaining_invites` returns `NULL` so issuance remains unlimited.
- Preserved the manual allowance branch, including `quota_mode`, `handed`, not-handed zero totals, and handed quotas.
- Manual removals now return `INSUFFICIENT_QUOTA` if they would reduce quota below already-used invitations.
- Automatic removals now return `INSUFFICIENT_QUOTA` if they exceed the current bonus.
- Audit deltas are computed as `after - before`, and automatic after-snapshots use `coalesce(asset limit, resort-type limit, 0) + bonus`.
- Applied the migration to Supabase project `zyawkaobhgshuzdhsqjs`.
- Post-apply live verification found zero limited-allowance mismatches and confirmed both unlimited cabine checks return `NULL` from `remaining_invites`.
- Rollback-only live tests passed for lower and higher per-asset overrides, automatic over-removal rejection, manual over-removal rejection, and `after - before` audit invariants in both modes.
- Staff and Resortly migration SHA-256 hashes match: `C20C702ACC2EBC2494551F2604331D0FB9C923C6EA703AC0BD2EFFC2687E48EA`.
