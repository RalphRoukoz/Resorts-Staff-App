# Chalet owner vs tenant invite defaults — Design

**Date:** 2026-09-16  
**Apps:** Resorts-Staff-App (config + Invite Quotas), Resortly (types/mirrors only as needed), shared Supabase  
**Status:** Approved for planning (product sign-off 2026-09-16)

## Problem

Resorts want different monthly invitation defaults for chalets depending on whether the unit is **owner-occupied** or **rented to a tenant**. Today every chalet shares one weekday/weekend pair at hand-over.

## Goals

1. Optional per-resort feature: separate **owner** and **tenant** chalet invitation defaults (weekday + weekend each).
2. When the feature is off, keep today’s single `chalet_weekday_limit` / `chalet_weekend_limit` behavior.
3. Hand-over prefills use the matching pair based on **active tenancy covering Beirut today**.
4. Hand-over UI shows a clear **Rented** vs **Owner** (not rented) tag.
5. Mid-month rental after hand-over does **not** change already-handed quota.

## Non-goals

- Cabine owner/tenant split (cabines unchanged).
- Auto-switching handed quota when tenancy starts mid-month.
- Changing who may issue invitations (access rules stay as today).
- Per-asset owner/tenant default overrides (resort-level only).

## Decisions (from product)

| Topic | Decision |
|-------|----------|
| Shape | Two full pairs: owner weekday/weekend + tenant weekday/weekend |
| Optionality | Per-resort toggle; off → legacy single chalet limits |
| Occupancy | Active tenancy with `starts_on ≤ today ≤ ends_on` (Beirut) → rented |
| Mid-month change | Leave handed numbers until next month’s hand-over |
| Editors | Same places that edit chalet limits today (superadmin + resort admin config) |

## Schema

Add to `resorts` (names may be adjusted in plan for consistency):

- `chalet_owner_tenant_limits_enabled` boolean NOT NULL DEFAULT false
- `chalet_owner_weekday_limit` integer (nullable or defaulted; used when enabled)
- `chalet_owner_weekend_limit` integer
- `chalet_tenant_weekday_limit` integer
- `chalet_tenant_weekend_limit` integer

When enabled is false, hand-over and UI continue to use `chalet_weekday_limit` / `chalet_weekend_limit`.

When enabled is true, hand-over defaults for **chalets** use owner or tenant pair. Legacy `chalet_weekday_limit` / `chalet_weekend_limit` remain for feature-off mode. Migration seeds owner + tenant pairs from the legacy chalet limits so enabling the toggle does not surprise staff with empty fields.

Mirror migrations in Resortly + Staff.

## RPC / list behavior

`list_resort_invite_quotas` (and any hand-over prefill helper):

- For each chalet row, compute `occupancy`: `'rented' | 'owner'` from active tenancy today.
- Expose `default_weekday` / `default_weekend` using:
  - feature off → resort `chalet_*` limits
  - feature on + rented → tenant pair
  - feature on + owner → owner pair
- Expose occupancy (or boolean `is_rented`) for UI tag.
- Cabine rows unchanged (cabine resort limits).

`hand_over_asset_invite_quota` still accepts staff-entered numbers; no server rewrite of amounts after confirm.

## Staff UI

1. **SuperResortsPage / ResortConfigPage** — toggle + four fields when on; hide or disable four fields when off; keep existing single chalet limits when off.
2. **InviteQuotasPage** — on Hand over (and list if useful): tag **Rented** / **Owner**; prefill from list RPC defaults.

## Owner app

No required UX change for this feature beyond continuing to consume handed quotas. Types/resort field selects updated if owner reads resort limits for display.

## Testing

- Feature off: hand-over prefills match current chalet limits.
- Feature on, no active tenancy: Owner tag + owner pair.
- Feature on, active tenancy today: Rented tag + tenant pair.
- After hand-over, create tenancy mid-month: stored quota unchanged.
- Cabine hand-over unaffected.

## Related

- Builds on: `2026-09-05-manual-invite-quota-handout-design.md`
- Companion (same product batch): Resortly explore unread badges spec
