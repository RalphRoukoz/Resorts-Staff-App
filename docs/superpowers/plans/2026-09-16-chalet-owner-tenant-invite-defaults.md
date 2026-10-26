# Chalet Owner vs Tenant Invite Defaults — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional resort config for separate owner vs tenant chalet invitation defaults; hand-over prefills and Rented/Owner tag from active tenancy today.

**Architecture:** New `resorts` columns + toggle; extend `list_resort_invite_quotas` to compute occupancy and pick default pair; Staff config + Invite Quotas UI; mirror SQL into Resortly; apply live.

**Tech Stack:** Postgres/Supabase RPCs, React Staff app, TypeScript, i18next

## Global Constraints

- Optional per resort; off → keep `chalet_weekday_limit` / `chalet_weekend_limit`.
- Two pairs when on: owner weekday/weekend + tenant weekday/weekend.
- Occupancy = active tenancy covering Beirut today.
- Mid-month rental does not change handed quota.
- Cabines unchanged.
- Mirror migrations Staff + Resortly; apply to live project `zyawkaobhgshuzdhsqjs`.

---

## File map

| Area | Files |
|------|--------|
| Migration | `Resorts-Staff-App/supabase/migrations/20260916120000_chalet_owner_tenant_invite_defaults.sql` (+ Resortly mirror) |
| Types | `Resorts-Staff-App/src/types/database.ts`, Resortly `types` / `resortFields` if needed |
| Config UI | `SuperResortsPage.tsx`, `ResortConfigPage.tsx`, `update_resort_admin_settings` |
| Quotas UI | `InviteQuotasPage.tsx`, i18n en/ar/fr |
| Helpers | `resortLimits.ts` (optional helper for owner/tenant defaults) |

---

### Task 1: Schema + list_resort_invite_quotas

**Files:** Create migration in both repos

- [ ] Add columns:
  - `chalet_owner_tenant_limits_enabled boolean NOT NULL DEFAULT false`
  - `chalet_owner_weekday_limit`, `chalet_owner_weekend_limit`, `chalet_tenant_weekday_limit`, `chalet_tenant_weekend_limit` integer NOT NULL
- [ ] Backfill: set all four from existing `chalet_weekday_limit` / `chalet_weekend_limit`
- [ ] Replace `list_resort_invite_quotas`:
  - Load new columns
  - For each chalet: `is_rented` = exists tenancy with `starts_on <= today_beirut() AND ends_on >= today_beirut()`
  - `occupancy` = `'rented' | 'owner'` (cabines: `'n/a'` or omit)
  - `default_weekday` / `default_weekend`:
    - cabine → cabine limits
    - chalet + feature off → legacy chalet limits
    - chalet + on + rented → tenant pair
    - chalet + on + owner → owner pair
- [ ] Apply migration live via Supabase MCP
- [ ] Commit

### Task 2: update_resort_admin_settings + types

- [ ] Extend `update_resort_admin_settings` with toggle + four ints (validate ≥ 0)
- [ ] Extend `InviteQuotaUnitRow` with `occupancy?: 'rented' | 'owner' | 'n/a'` and/or `is_rented?: boolean`
- [ ] Extend `Resort` type with new fields
- [ ] Mirror into Resortly types/resortFields
- [ ] Commit

### Task 3: Superadmin + Resort config UI

- [ ] SuperResortsPage: toggle; when on show 4 fields; when off keep legacy chalet pair
- [ ] ResortConfigPage: same for resort admins via updated RPC
- [ ] i18n keys
- [ ] Commit

### Task 4: Invite Quotas hand-over tag

- [ ] Show **Rented** / **Owner** tag on unit row and/or hand-over modal (chalets only)
- [ ] Prefill already uses `default_*` from RPC — verify after Task 1
- [ ] i18n
- [ ] Commit

### Task 5: Verify

- [ ] Feature off: defaults match legacy
- [ ] Feature on + no tenancy: Owner + owner pair
- [ ] Feature on + active tenancy: Rented + tenant pair
- [ ] Cabine unchanged
