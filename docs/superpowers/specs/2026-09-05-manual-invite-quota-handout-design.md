# Manual invite quota handout — Design

**Date:** 2026-09-05  
**Apps:** Resorts-Staff-App (primary), Resortly (owner UX + shared Supabase)  
**Status:** Draft for implementation planning

## Problem

A resort wants invitations **handed out by staff as monthly quotas**, not auto-filled from resort defaults. They also want cabine invitations fully disabled (unit not tappable), and a clear audit trail of who granted what to which unit.

## Goals

1. Superadmin can set a resort to **automatic** or **manual** invitation quota mode.
2. Staff get a dedicated **Invite quotas** page to hand over / add / remove quotas (with audit log).
3. When cabine invitations are disabled, cabine units are listed but **not tappable**.
4. In manual mode, units with no handout for the current calendar month: **no invite counts**, **cannot issue invitations**, chalets can still **announce visitors**.
5. On each calendar month start, leftover quota is wiped; staff must hand over again.

## Non-goals

- Staff creating guest invitation records (name/date/QR) on behalf of owners.
- Changing scan / Today / analytics pipelines beyond reading the new quota source.
- Per-unit invitation season (still resort-level).
- Cabine-only handout rules that differ from chalets (same rules for both when cabines enabled).

## Decisions (from product)

| Topic | Decision |
|-------|----------|
| Handout meaning | Assign **quota**; owners still issue guest QRs |
| Default amounts | Resort type defaults; optional custom override at hand over |
| Units / Rentals bonus UI | **Removed everywhere** |
| New page | All resorts; Hand over only in **manual**; Add/Remove always |
| Adjustments | After hand over, Add/Remove still allowed; **every** change logged |
| Month roll | Calendar month; remaining quota cleared; re-hand required |
| Asset types | Chalets and cabines (when cabine invites enabled) |
| Cabines off | Unit card visible, **tap does nothing** |

---

## Architecture overview

```
Superadmin: invitation_quota_mode + cabine_invites_enabled
        │
        ▼
Staff Invite Quotas page ──RPC──► asset_period_quotas + invitation_quota_events
        │
        ▼
asset_invite_allowance / remaining_invites / issue_invitation
        │
        ▼
Owner app: counts / Issue / visitors / cabine tap lock
```

**Approach:** Period quota row + append-only audit log (not ledger-only, not bonus-column-only).

---

## Data model

### `resorts`

| Column | Type | Notes |
|--------|------|--------|
| `invitation_quota_mode` | `text` not null default `'automatic'` | `'automatic'` \| `'manual'` |
| `cabine_invites_enabled` | existing boolean | Unchanged semantics; owner UX tightened |

### `asset_period_quotas`

One row per asset per calendar month (`period_ym` = `'YYYY-MM'`, Beirut month).

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `asset_id` | uuid FK → assets | |
| `resort_id` | uuid FK → resorts | denormalized for RLS/queries |
| `period_ym` | text | e.g. `2026-09` |
| `weekday_quota` | int ≥ 0 | granted total for month (not remaining) |
| `weekend_quota` | int ≥ 0 | |
| `handed_over_at` | timestamptz | set on first hand over in that period; null = not handed (manual) |
| `updated_at` | timestamptz | |

Unique `(asset_id, period_ym)`.

**Automatic mode:** system may materialize or synthesize quota from resort/asset limits without requiring `handed_over_at`. Owner issuance does not depend on hand over.

**Manual mode:** issuance allowed only if `handed_over_at IS NOT NULL` for current `period_ym`. Allowance totals come from this row (plus used counts from invitations), not from automatic base+bonus.

### `invitation_quota_events` (audit log)

Append-only.

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `resort_id` | uuid | |
| `asset_id` | uuid | |
| `period_ym` | text | |
| `action` | text | `hand_over` \| `add` \| `remove` \| `month_reset` |
| `weekday_delta` | int | signed; hand_over stores absolute as positive set |
| `weekend_delta` | int | |
| `weekday_after` | int | snapshot after change |
| `weekend_after` | int | |
| `actor_user_id` | uuid | auth user |
| `actor_username` | text | staff username at time of action (denormalized) |
| `note` | text null | optional |
| `created_at` | timestamptz | |

For `hand_over`, store deltas as the granted amounts (from 0) and after snapshots. For `month_reset`, system actor username `'system'`, deltas negative to zero.

### Month reset

- Triggered **lazily** on first read/write that observes `period_ym < current Beirut month` for an asset that still has a prior-month row with remaining conceptual quota, **and/or** a scheduled/edge nightly job.
- Preferred v1: **lazy** inside quota RPCs: when resolving current month, if previous month had a row, write `month_reset` events as needed and do not carry remaining into the new month (new month starts empty / not handed in manual).
- Already-issued invitation rows for visit dates are **not** cancelled by month reset; only unused **quota** is cleared.

### Permissions

| Permission | Meaning |
|------------|---------|
| `invitations.quota` | Access Invite quotas page; hand over / add / remove |
| `invitations.bonus` | **Deprecated for UI**; keep RPC grants temporarily mapped to same check as `invitations.quota` or retire after cutover |

- Owner/admin roles (`is_owner` / legacy admin): include `invitations.quota` in `ALL_PERMISSIONS`.
- Custom roles: show in role editor.
- Migrate existing roles that had `invitations.bonus` → also get `invitations.quota`.

---

## Staff app UX

### Superadmin (`SuperResortsPage`)

- Control: **Invitation quotas** — Automatic | Manual handout.
- Hint under Manual: staff must hand over monthly; leftover clears on the 1st.
- Existing **Enable cabine invitations** checkbox unchanged.

### Nav + route

- Admin nav: **Invite quotas** → `/admin/invite-quotas`.
- Guard: `RequirePermission(PERMISSIONS.INVITATIONS_QUOTA)` (name in code: `invitations.quota`).
- Visible when user has that permission (owners by default).

### Invite quotas page

**Chrome**

- Month label (Beirut current month).
- Mode badge: Automatic | Manual handout.
- Search by unit label.
- Filters: All | Not handed (manual only) | Handed | Chalets | Cabines.

**Table**

Columns: Unit · Type · Weekday quota · Weekend quota · Used (month) · Status · Actions.

| Mode / state | Status | Actions |
|--------------|--------|---------|
| Manual, not handed | Not handed | **Hand over** |
| Manual, handed | Handed (+ last hand-over date) | Add / Remove |
| Automatic | Automatic | Add / Remove only |

**Hand over dialog**

- Prefill weekday/weekend from resort defaults for asset type (`chalet_*` / `cabine_*` limits, respecting per-asset overrides if present).
- Editable fields; Confirm → RPC hand_over + log.

**Add / Remove dialog**

- Day type or both weekday/weekend amounts (≥ 1).
- Optional note.
- Confirm → RPC + log (even +1).

**Activity log** (same page, section or tab)

- Newest first: datetime · username · action · unit · deltas.
- Filters: unit, action type.
- Read-only.

### Units page

- Remove grant/remove bonus UI and related buttons.
- May still **display** remaining/used for ops visibility (read-only).

### Rentals page

- Confirm no bonus controls; if any exist, remove.

---

## Owner app (Resortly) UX

### Cabine invites disabled (`cabine_invites_enabled = false`)

- Unit appears on list.
- Tap / activate: **no-op** (not navigable). Visual: muted / no chevron (or disabled affordance).
- Deep links to `/units/:id` for that cabine: redirect back to `/units` or locked empty state.

### Manual mode + not handed for current month

- Hide allowance / invite counts on card and hub.
- Hide / disable **Issue invitation** (and related issuable-unit lists).
- **Announce visitors** remains for chalets when visitor rules allow.
- Secondary “Invitations” list can remain (history) or stay visible empty — prefer keep history list, hide Issue + counts only.
- RPC `issue_invitation` must reject server-side if not handed (`NOT_HANDED` / equivalent).

### Automatic mode

- Existing allowance behavior, including staff add/remove via new page (replacing Units bonus UI).

---

## RPCs (sketch)

| RPC | Role |
|-----|------|
| `hand_over_asset_invite_quota(p_asset, p_weekday, p_weekend, p_note?)` | Manual only; creates/updates period row; requires not conflicting; logs `hand_over` |
| `adjust_asset_invite_quota(p_asset, p_weekday_delta, p_weekend_delta, p_note?)` | Both modes; manual requires already handed; clamps ≥ 0; logs `add` or `remove` |
| `list_resort_invite_quotas(p_resort, p_period_ym?)` | Staff table data |
| `list_invitation_quota_events(p_resort, …)` | Audit log |
| Update `asset_invite_allowance` / `remaining_invites` / `issue_invitation` | Respect mode + hand over + period quotas |

Permission: `caller_has_resort_permission(..., 'invitations.quota')` (and map legacy bonus).

Staff username: resolve from `resort_staff.username` for actor.

---

## Error handling

- Hand over twice in same month: upsert allowed only as re-hand? **v1:** reject second hand_over; use add/remove after first. (Clearer audit.)
- Remove below zero: reject.
- Manual issue without hand over: reject with stable error code for i18n.
- Cabine invites disabled: handout page still lists cabines but actions disabled with hint; or hide cabines from handout list when disabled — **prefer hide** from handout list when `cabine_invites_enabled = false`.

---

## Testing (acceptance)

1. Superadmin sets resort to Manual; owner sees no counts and cannot issue until staff hands over.
2. Hand over with defaults; owner sees counts and can issue up to quota.
3. Add +1 and remove −1 each create log rows with username, unit, time.
4. New Beirut month: quota gone, not handed; owner blocked again until re-hand.
5. Automatic resort: no Hand over button; Add/Remove works; Units page has no bonus controls.
6. Cabine invites off: cabine card not tappable; owner still uses rest of app.
7. Custom role without `invitations.quota` cannot open page; owner role can.
8. Already-issued invites for future visit dates survive month quota wipe.

## Migration / dual-repo

- Add mirrored SQL under both `Resorts-Staff-App/supabase/migrations` and `Resortly/supabase/migrations`.
- Apply once to shared project.

## Open implementation details (fixed here)

- Second hand_over same month: **rejected**; use adjust.
- Month reset: **lazy** in quota RPCs + optional later cron.
- Cabines when invites disabled: **hidden** on Invite quotas page.
- Spec location: this file under Staff app docs (covers both apps).
