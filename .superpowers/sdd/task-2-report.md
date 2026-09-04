# Task 2 Report: Hand-over, adjust, list, and log RPCs

## Status: DONE

## Commit

- `1a358ac` — `feat(db): invite quota hand-over and adjust RPCs with audit log`

## What was implemented

Created `supabase/migrations/20260905121000_manual_invite_quota_rpcs.sql` with:

1. `caller_can_manage_invite_quota(uuid)`
   - Accepts `invitations.quota`, legacy `invitations.bonus`, resort admin, or superadmin.

2. `hand_over_asset_invite_quota(uuid, integer, integer, text)`
   - Manual-mode and cabine-enabled enforcement.
   - Allows explicit `0/0` hand-over and rejects negative/null quotas.
   - Uses a transaction advisory lock so only the first monthly hand-over succeeds.
   - Upserts the current Beirut-month quota and records a `hand_over` event.

3. `adjust_asset_invite_quota(uuid, integer, integer, text)`
   - Rejects no-op and mixed-sign deltas.
   - Manual mode requires hand-over and clamps each quota to its already-used count.
   - Automatic mode atomically adds/removes monthly bonuses and returns base+bonus totals.
   - Records every successful `add` or `remove`, including one-invite changes.

4. `list_resort_invite_quotas(uuid, text)`
   - Supports current/default or explicit `YYYY-MM` periods.
   - Returns status, quotas, usage, hand-over timestamp, and hand-over defaults per unit.
   - Prefers asset limits over resort type defaults.
   - Excludes cabines when cabine invitations are disabled.

5. `list_invitation_quota_events(uuid, uuid, integer)`
   - Returns newest-first audit events with unit labels.
   - Supports optional asset filtering and caps the requested limit at 200.

All five functions are `SECURITY DEFINER` with an explicit `search_path`. Execute access is revoked from `PUBLIC`/`anon` and granted to `authenticated`.

## Supabase application

- Project: `zyawkaobhgshuzdhsqjs`
- Applied with migration name: `manual_invite_quota_rpcs`
- Recorded migration version: `20260904212854`

## Verification

- Pre-implementation function lookup confirmed all five Task 2 RPCs were absent.
- Migration application succeeded.
- Post-application catalog check found all five exact signatures returning the required types.
- All functions have `search_path=public`; authenticated execute is true and anon execute is false.
- No-JWT smoke calls returned `NOT_AUTHORIZED` for all four public workflow RPCs and `false` for the auth helper, without mutating quota data.
- `git diff --cached --check` passed before commit.

## Self-review

- Requirements were checked against the Task 2 brief after implementation.
- Second hand-over is serialized and returns `ALREADY_HANDED`, including when the retry supplies invalid quota values.
- Manual reductions cannot lower quota below used invitations.
- Automatic adjustments preserve existing bonus-table clamp behavior.
- Audit writes and returned after-values are in the same transaction as each adjustment.
- List usage matches the existing allowance definition: validated, or future/current issued, split by day type.
- Existing untracked `.superpowers/`, `docs/superpowers/`, and `graphify-out/` content was not included in the code commit.

## Concerns

- None blocking. Per the brief, shared-production verification was limited to catalog/grant checks and non-mutating unauthorized smoke calls; authenticated mutating business paths were not exercised against live resort data.

## Review fix: resort-based automatic after-values

- Updated the source migration so `adjust_asset_invite_quota` no longer reads or falls back to asset-level weekday/weekend limits.
- Automatic-mode after-values now use the asset type's resort limits only: `cabine_*_limit` for cabines and `chalet_*_limit` for chalets, plus the persisted monthly bonus.
- Applied Supabase migration `fix_adjust_invite_quota_resort_base` to project `zyawkaobhgshuzdhsqjs`; recorded version: `20260904213353`.

### Fix verification

- Catalog lookup found `adjust_asset_invite_quota(uuid,integer,integer,text)` returning `jsonb`.
- Deployed function-body checks confirmed the asset-limit variable is absent and both resort weekday/weekend base expressions are present.
- Supabase migration history contains `fix_adjust_invite_quota_resort_base`.
