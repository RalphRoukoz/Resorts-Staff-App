# Task 3 Report: Manual invitation allowance enforcement

## Status

Implemented and applied `manual_invite_quota_allowance` to shared Supabase project
`zyawkaobhgshuzdhsqjs`.

## Changes

- Added migration `20260905122000_manual_invite_quota_allowance.sql`.
- Replaced the live `asset_invite_allowance(uuid)` definition and preserved its
  authorization, asset-level automatic limits, bonus calculation, used-count filters,
  and lack of a cabine-unlimited branch.
- Added `quota_mode` and `handed` to allowance responses.
- Manual assets now expose zero remaining before hand-over and period quotas after
  hand-over.
- Replaced the live `remaining_invites(uuid,text,date)` definition so manual quotas
  are enforced for the requested month while automatic behavior remains unchanged.
- Replaced the live `issue_invitation(uuid,text,text,date)` definition so an unhanded
  manual asset raises `NOT_HANDED` before allowance consumption or insertion.

## Contract decision

The brief anticipated that `issue_invitation` might return JSONB. The live function
actually returns `public.invitations` and all existing business failures are exceptions.
Returning `{ "error": "NOT_HANDED" }` is impossible without changing the public return
type, so this migration preserves the live contract and raises `NOT_HANDED`.

## Verification

Pre-migration RED check confirmed all three required branches were absent.

Post-migration checks:

- `pg_get_functiondef` confirms all three functions were replaced.
- Rolled-back live-data quota test returned:
  - automatic remaining: `2`
  - manual, not handed remaining: `0`
  - manual, handed quota `7`: remaining `7`
- Rolled-back authenticated allowance test returned:
  - automatic: `quota_mode=automatic`, `handed=null`
  - manual/unhanded: `quota_mode=manual`, `handed=false`, both remaining values `0`
- Rolled-back invitation test raised `NOT_HANDED` and inserted no invitation.
- `git diff --check` passed.
- Supabase security and performance advisors were run. They report existing
  project-wide informational/advisory items; no new table, policy, or index was added
  by this function-only migration.

## Self-review

- Compared replacements against live definitions rather than stale migrations.
- Automatic allowance behavior retains asset overrides and resort fallbacks.
- Invitation status/date filters are unchanged.
- Manual hand-over lookup is month-scoped and missing/unhanded rows fail closed.
- No invite cancellation or month-reset side effect was introduced.
- No optional helper was added.

## Concerns

- Callers must already handle PostgreSQL exceptions from `issue_invitation`; the new
  `NOT_HANDED` failure follows that existing API convention.
