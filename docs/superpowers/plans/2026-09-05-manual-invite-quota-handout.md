# Manual Invite Quota Handout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let resorts run invitation quotas in automatic or manual-handout mode, with a staff Invite Quotas page + audit log, cabine tap-lock when invites are disabled, and owner-app blocking until a unit is handed over for the current Beirut month.

**Architecture:** Shared Supabase adds `resorts.invitation_quota_mode`, `asset_period_quotas`, and append-only `invitation_quota_events`. Manual mode uses period quotas (hand over required); automatic mode keeps base+bonus math but routes add/remove through logged adjust RPCs. Staff UI moves all quota edits off Units onto `/admin/invite-quotas`. Resortly tightens cabine + not-handed UX and trusts updated RPCs.

**Tech Stack:** Supabase SQL (SECURITY DEFINER RPCs), Resorts-Staff-App (Vite/React/TS), Resortly (Vite/React/TS), mirrored migrations in both repos.

**Spec:** `docs/superpowers/specs/2026-09-05-manual-invite-quota-handout-design.md`

## Global Constraints

- Calendar month = Beirut (`public.today_beirut()`); `period_ym` format `YYYY-MM`.
- Second `hand_over` in the same month for the same asset → reject (`ALREADY_HANDED`); use adjust after.
- Every hand_over / add / remove / month_reset writes `invitation_quota_events` (even ±1).
- Month roll clears unused **quota**, does not cancel existing invitation rows.
- Cabines with `cabine_invites_enabled = false`: hidden from Invite Quotas list; owner unit card not tappable.
- Permission key: `invitations.quota`. Roles that had `invitations.bonus` must gain `invitations.quota`.
- Mirror every SQL migration into both `Resorts-Staff-App/supabase/migrations/` and `Resortly/supabase/migrations/` with the same filename; apply once to the shared project.
- No new npm test runner — verify with `npm run build`, SQL checks, and manual acceptance from the spec.

---

## File map

| Path | Responsibility |
|------|----------------|
| `Resorts-Staff-App/supabase/migrations/20260905120000_manual_invite_quota_handout.sql` | Schema + RPCs (canonical) |
| `Resortly/supabase/migrations/20260905120000_manual_invite_quota_handout.sql` | Identical mirror |
| `Resorts-Staff-App/src/types/database.ts` | `invitation_quota_mode`, quota types |
| `Resorts-Staff-App/src/lib/permissions.ts` | `INVITATIONS_QUOTA`, labels, expand bonus→quota |
| `Resorts-Staff-App/src/pages/superadmin/SuperResortsPage.tsx` | Mode toggle |
| `Resorts-Staff-App/src/pages/admin/InviteQuotasPage.tsx` | New page |
| `Resorts-Staff-App/src/pages/admin/AdminLayout.tsx` | Nav item |
| `Resorts-Staff-App/src/App.tsx` | Route |
| `Resorts-Staff-App/src/pages/admin/UnitsPage.tsx` | Remove bonus UI |
| `Resorts-Staff-App/src/i18n/locales/*.json` | Nav + page strings |
| `Resortly/src/types/index.ts` + `lib/resortFields.ts` | Mode field on resort |
| `Resortly/src/lib/unitAccess.ts` | `not_handed`, cabine tap-lock helpers |
| `Resortly/src/components/units/UnitCard.tsx` | Non-tappable cabine; hide counts |
| `Resortly/src/pages/units/UnitHubPage.tsx` | Hide issue/counts when not handed |
| `Resortly/src/pages/units/IssueInvitationPage.tsx` | Guard not_handed |
| `Resortly/src/hooks/useIssuableUnits.ts` | Exclude not-handed |
| `Resortly/src/i18n/locales/{en,fr,ar}.json` | Copy |

---

### Task 1: Schema + permission bootstrap migration

**Files:**
- Create: `Resorts-Staff-App/supabase/migrations/20260905120000_manual_invite_quota_handout.sql`
- Create: `Resortly/supabase/migrations/20260905120000_manual_invite_quota_handout.sql` (identical copy at end of this task or Task 4)

**Interfaces:**
- Produces: `resorts.invitation_quota_mode`, tables `asset_period_quotas`, `invitation_quota_events`, helper `current_period_ym()`, helper `staff_username_for_actor()`

- [ ] **Step 1: Write migration header + column + tables**

Start `20260905120000_manual_invite_quota_handout.sql` with:

```sql
-- Manual vs automatic invitation quota handout + audit log.
-- Mirrored in Resortly — apply once to shared Supabase.

ALTER TABLE public.resorts
  ADD COLUMN IF NOT EXISTS invitation_quota_mode text NOT NULL DEFAULT 'automatic';

ALTER TABLE public.resorts
  DROP CONSTRAINT IF EXISTS resorts_invitation_quota_mode_check;

ALTER TABLE public.resorts
  ADD CONSTRAINT resorts_invitation_quota_mode_check
  CHECK (invitation_quota_mode IN ('automatic', 'manual'));

COMMENT ON COLUMN public.resorts.invitation_quota_mode IS
  'automatic = resort defaults + bonuses; manual = staff must hand over monthly quotas';

CREATE TABLE IF NOT EXISTS public.asset_period_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  period_ym text NOT NULL,
  weekday_quota integer NOT NULL DEFAULT 0 CHECK (weekday_quota >= 0),
  weekend_quota integer NOT NULL DEFAULT 0 CHECK (weekend_quota >= 0),
  handed_over_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_ym)
);

CREATE INDEX IF NOT EXISTS asset_period_quotas_resort_period_idx
  ON public.asset_period_quotas (resort_id, period_ym);

CREATE TABLE IF NOT EXISTS public.invitation_quota_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  period_ym text NOT NULL,
  action text NOT NULL CHECK (action IN ('hand_over', 'add', 'remove', 'month_reset')),
  weekday_delta integer NOT NULL DEFAULT 0,
  weekend_delta integer NOT NULL DEFAULT 0,
  weekday_after integer NOT NULL DEFAULT 0,
  weekend_after integer NOT NULL DEFAULT 0,
  actor_user_id uuid,
  actor_username text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitation_quota_events_resort_created_idx
  ON public.invitation_quota_events (resort_id, created_at DESC);

CREATE INDEX IF NOT EXISTS invitation_quota_events_asset_created_idx
  ON public.invitation_quota_events (asset_id, created_at DESC);
```

- [ ] **Step 2: Helpers + migrate role permissions**

Append:

```sql
CREATE OR REPLACE FUNCTION public.current_period_ym()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(date_trunc('month', public.today_beirut())::date, 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public.staff_username_for_actor(p_resort_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT rs.username
       FROM public.resort_staff rs
      WHERE rs.user_id = auth.uid()
        AND rs.resort_id = p_resort_id
      ORDER BY rs.created_at
      LIMIT 1),
    (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()),
    'unknown'
  );
$$;

-- Expand invitations.bonus → invitations.quota on custom roles
UPDATE public.resort_roles
   SET permissions = (
     SELECT array_agg(DISTINCT p)
       FROM unnest(
         permissions || CASE
           WHEN 'invitations.bonus' = ANY (permissions)
             AND NOT ('invitations.quota' = ANY (permissions))
           THEN ARRAY['invitations.quota']
           ELSE ARRAY[]::text[]
         END
       ) AS p
   )
 WHERE permissions IS NOT NULL
   AND 'invitations.bonus' = ANY (permissions);
```

- [ ] **Step 3: RLS policies (staff read/write via RPCs only)**

Prefer **no direct table grants to authenticated** for writes; RPCs are SECURITY DEFINER. Optionally enable RLS with deny-all for authenticated and rely on RPCs:

```sql
ALTER TABLE public.asset_period_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_quota_events ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated → only SECURITY DEFINER RPCs access.
REVOKE ALL ON public.asset_period_quotas FROM authenticated, anon;
REVOKE ALL ON public.invitation_quota_events FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.asset_period_quotas TO service_role;
GRANT SELECT, INSERT ON public.invitation_quota_events TO service_role;
```

(Adjust if project already grants table access differently — match sibling tables like `asset_invite_bonuses`.)

- [ ] **Step 4: Verify locally / on staging**

Run migration against the shared project (CLI or SQL editor). Check:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'resorts' AND column_name = 'invitation_quota_mode';
SELECT to_regclass('public.asset_period_quotas');
SELECT to_regclass('public.invitation_quota_events');
SELECT public.current_period_ym();
```

Expected: column exists, both tables exist, `period_ym` like `2026-09`.

- [ ] **Step 5: Commit** (Staff app repo)

```bash
git add supabase/migrations/20260905120000_manual_invite_quota_handout.sql
git commit -m "feat(db): add invite quota mode tables and period helpers"
```

---

### Task 2: Hand-over, adjust, list, and log RPCs

**Files:**
- Modify: `Resorts-Staff-App/supabase/migrations/20260905120000_manual_invite_quota_handout.sql` (append)

**Interfaces:**
- Consumes: tables/helpers from Task 1; `caller_has_resort_permission` / `staff_has_permission` / `is_staff` / `is_superadmin`
- Produces:
  - `hand_over_asset_invite_quota(p_asset uuid, p_weekday int, p_weekend int, p_note text default null) → jsonb`
  - `adjust_asset_invite_quota(p_asset uuid, p_weekday_delta int, p_weekend_delta int, p_note text default null) → jsonb`
  - `list_resort_invite_quotas(p_resort_id uuid, p_period_ym text default null) → jsonb`
  - `list_invitation_quota_events(p_resort_id uuid, p_asset_id uuid default null, p_limit int default 100) → jsonb`
  - Internal: `caller_can_manage_invite_quota(p_resort_id uuid) → boolean`

- [ ] **Step 1: Auth helper**

```sql
CREATE OR REPLACE FUNCTION public.caller_can_manage_invite_quota(p_resort_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_superadmin()
      OR public.caller_has_resort_permission(p_resort_id, 'invitations.quota')
      OR public.caller_has_resort_permission(p_resort_id, 'invitations.bonus')
      OR public.is_staff(p_resort_id, 'admin');
$$;
```

- [ ] **Step 2: `hand_over_asset_invite_quota`**

Behavior:
- Load asset + resort; require `invitation_quota_mode = 'manual'`.
- Reject if cabine and `cabine_invites_enabled = false` → `CABINE_INVITES_DISABLED`.
- Reject if current period row already has `handed_over_at` → `ALREADY_HANDED`.
- Require `p_weekday >= 0`, `p_weekend >= 0`, and at least one path allowed (0/0 OK only if product wants empty hand over — **spec: allow 0/0** so staff can explicitly hand zero? Prefer require at least defaults; allow 0/0).
- Upsert `asset_period_quotas` with quotas + `handed_over_at = now()`.
- Insert event `hand_over` with deltas = granted amounts, after = quotas, username from helper.
- Return `{ ok: true, weekday_quota, weekend_quota, period_ym }`.

- [ ] **Step 3: `adjust_asset_invite_quota`**

Behavior:
- Auth via `caller_can_manage_invite_quota`.
- Deltas may be positive (add) or negative (remove); both zero → `NO_CHANGE`.
- **Manual:** require handed row for `current_period_ym()`; update `weekday_quota`/`weekend_quota` with `greatest(0, quota + delta)`; if clamp would go below used counts, prefer clamp to used (do not allow quota < used) — implement `greatest(used, quota + delta)`.
- **Automatic:** call existing bonus math: positive → same as `grant_asset_invite_bonus`; negative → `remove_asset_invite_bonus` absolute values; then log event with after = base+bonus totals from `asset_invite_allowance` logic (or read bonuses table + bases).
- Action field: `add` if both deltas ≥ 0 and any > 0; `remove` if both ≤ 0 and any < 0; if mixed signs, apply both and set action to `add` when net weekday+weekend > 0 else `remove` (or reject mixed → simpler: **reject mixed signs** with `INVALID_DELTA`).
- Always insert `invitation_quota_events`.

- [ ] **Step 4: List RPCs**

`list_resort_invite_quotas`:
- Auth: dashboard.read OR invitations.quota OR admin.
- Return array of units (exclude cabines when `cabine_invites_enabled = false`).
- Each item: `asset_id`, `label`, `asset_type`, `weekday_quota`, `weekend_quota`, `weekday_used`, `weekend_used`, `handed_over_at`, `status` (`not_handed` | `handed` | `automatic`), defaults for hand-over prefill from resort/asset limits.

`list_invitation_quota_events`:
- Auth same as manage or dashboard.read.
- Newest first, optional asset filter, limit capped at 200.

- [ ] **Step 5: GRANT EXECUTE** to `authenticated` for all four RPCs + helper if needed.

- [ ] **Step 6: Smoke-test in SQL editor** (use a test resort / staff JWT or `SET request.jwt.claim.sub`)

Expected errors without auth: `NOT_AUTHORIZED`. With staff on manual resort: hand_over succeeds once, second returns `ALREADY_HANDED`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260905120000_manual_invite_quota_handout.sql
git commit -m "feat(db): invite quota hand-over and adjust RPCs with audit log"
```

---

### Task 3: Wire allowance + issue_invitation to manual mode

**Files:**
- Modify: same migration file (append `CREATE OR REPLACE` for allowance / remaining / issue)

**Interfaces:**
- Consumes: `asset_period_quotas`, `invitation_quota_mode`
- Produces: updated `asset_invite_allowance(uuid)`, `remaining_invites(...)`, `issue_invitation(...)` rejecting `NOT_HANDED`

- [ ] **Step 1: Update `asset_invite_allowance`**

After resolving resort + asset type, branch:

```text
IF mode = 'manual' THEN
  look up asset_period_quotas for current_period_ym()
  IF handed_over_at IS NULL THEN
    RETURN jsonb with unavailable: true OR remaining 0 and flag handed: false
       -- include keys: month, handed: false, weekday/weekend totals 0, used counts still OK for staff
  ELSE
    base = 0, bonus = 0, total = weekday_quota / weekend_quota from row
  END
ELSE
  existing base + bonus logic
END
```

Add top-level `"handed": true|false|null` (`null` for automatic) and `"quota_mode": "manual"|"automatic"` so clients can branch without guessing.

- [ ] **Step 2: Update `remaining_invites`**

If manual and not handed → return 0. If handed → remaining from period quotas − used (same used definition as allowance).

- [ ] **Step 3: Update `issue_invitation`**

Near existing allowance check, after suspension checks:

```sql
IF v_resort.invitation_quota_mode = 'manual' THEN
  -- require handed_over_at for current period
  IF NOT FOUND OR handed_over_at IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_HANDED');
  END IF;
END IF;
```

Keep cabine_invites_enabled rejection as today.

- [ ] **Step 4: Lazy month note**

Document in COMMENT: new month simply has no row / not handed; no carry-over. Optional: when listing quotas, if prior month row exists and current missing, insert `month_reset` event once per asset (best-effort). Implement a small helper `ensure_period_quota_month(p_asset)` called from list/hand_over that logs `month_reset` when detecting transition (prior row exists, current absent, and prior had quotas > 0).

- [ ] **Step 5: Verify**

On a manual test asset without hand over:

```sql
SELECT public.asset_invite_allowance('<asset-uuid>');
-- handed: false
SELECT public.issue_invitation(...);
-- error NOT_HANDED
```

After hand_over, allowance shows totals; issue works until remaining 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905120000_manual_invite_quota_handout.sql
git commit -m "feat(db): enforce manual handout in allowance and issue_invitation"
```

---

### Task 4: Mirror migration into Resortly

**Files:**
- Create: `Resortly/supabase/migrations/20260905120000_manual_invite_quota_handout.sql`

- [ ] **Step 1: Copy file byte-for-byte** from Staff app migration.

```powershell
Copy-Item `
  "C:\Users\Dell\Desktop\Roukify\Resorts-Staff-App\supabase\migrations\20260905120000_manual_invite_quota_handout.sql" `
  "C:\Users\Dell\Desktop\Roukify\Resortly\supabase\migrations\20260905120000_manual_invite_quota_handout.sql"
```

- [ ] **Step 2: Confirm hashes match** (`Get-FileHash` both paths).

- [ ] **Step 3: Commit in Resortly repo**

```bash
cd C:\Users\Dell\Desktop\Roukify\Resortly
git add supabase/migrations/20260905120000_manual_invite_quota_handout.sql
git commit -m "feat(db): mirror manual invite quota handout migration"
```

---

### Task 5: Staff app types + permissions

**Files:**
- Modify: `Resorts-Staff-App/src/types/database.ts`
- Modify: `Resorts-Staff-App/src/lib/permissions.ts`

**Interfaces:**
- Produces: `Resort.invitation_quota_mode?: 'automatic' | 'manual'`; `PERMISSIONS.INVITATIONS_QUOTA = 'invitations.quota'`

- [ ] **Step 1: Extend `Resort` interface**

```ts
invitation_quota_mode?: 'automatic' | 'manual'
```

Add exported types near allowances:

```ts
export type InvitationQuotaMode = 'automatic' | 'manual'

export type InviteQuotaUnitRow = {
  asset_id: string
  label: string
  asset_type: AssetType
  weekday_quota: number | null
  weekend_quota: number | null
  weekday_used: number
  weekend_used: number
  handed_over_at: string | null
  status: 'not_handed' | 'handed' | 'automatic'
  default_weekday: number
  default_weekend: number
}
```

- [ ] **Step 2: Update permissions**

```ts
INVITATIONS_QUOTA: 'invitations.quota',
// keep INVITATIONS_BONUS for back-compat reads
```

Add `INVITATIONS_QUOTA` to `ALL_PERMISSIONS` (replace or keep bonus — **keep bonus in type union but remove from `ALL_PERMISSIONS` editor list**; map in `expandPermissions`):

```ts
function expandPermissions(perms: Iterable<string>): Set<Permission> {
  const set = new Set<Permission>()
  for (const p of perms) {
    set.add(p as Permission)
    if (p === PERMISSIONS.SCANNER) {
      set.add(PERMISSIONS.SCANNER_RECEPTION)
      set.add(PERMISSIONS.SCANNER_GATE)
    }
    if (p === PERMISSIONS.INVITATIONS_BONUS) {
      set.add(PERMISSIONS.INVITATIONS_QUOTA)
    }
  }
  return set
}
```

Labels:

```ts
'invitations.quota': 'Manage invitation quotas',
```

Description: hand over / add / remove monthly invitation quotas.

- [ ] **Step 3: `npm run build`** in Staff app — expect type errors only in files not yet updated (or none if optional fields).

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts src/lib/permissions.ts
git commit -m "feat(staff): add invitations.quota permission and resort mode type"
```

---

### Task 6: Superadmin mode toggle

**Files:**
- Modify: `Resorts-Staff-App/src/pages/superadmin/SuperResortsPage.tsx`

- [ ] **Step 1: Add form field**

```ts
invitation_quota_mode: 'automatic' | 'manual'
```

Defaults: `'automatic'`. Load/save with other resort fields on insert/update.

- [ ] **Step 2: UI control** near invite limits / cabine section:

Radio or select:

- Automatic
- Manual handout

Helper text: `Staff must hand over monthly quotas. Leftover quota clears at the start of each month.`

- [ ] **Step 3: Manual test** — save resort, reload, confirm value persists in DB:

```sql
SELECT name, invitation_quota_mode FROM resorts WHERE id = '...';
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/superadmin/SuperResortsPage.tsx
git commit -m "feat(staff): superadmin invitation quota mode toggle"
```

---

### Task 7: Invite Quotas page + nav + route

**Files:**
- Create: `Resorts-Staff-App/src/pages/admin/InviteQuotasPage.tsx`
- Modify: `Resorts-Staff-App/src/pages/admin/AdminLayout.tsx`
- Modify: `Resorts-Staff-App/src/App.tsx`
- Modify: `Resorts-Staff-App/src/i18n/locales/en.json` (and `fr.json` / `ar.json` if present)

**Interfaces:**
- Consumes: `list_resort_invite_quotas`, `list_invitation_quota_events`, `hand_over_asset_invite_quota`, `adjust_asset_invite_quota`, `PERMISSIONS.INVITATIONS_QUOTA`, `resort.invitation_quota_mode`

- [ ] **Step 1: Route**

In `App.tsx` under admin layout write routes:

```tsx
<Route element={<RequirePermission permission={PERMISSIONS.INVITATIONS_QUOTA} />}>
  <Route path="invite-quotas" element={<InviteQuotasPage />} />
</Route>
```

Import page + ensure `expandPermissions` means owners pass.

- [ ] **Step 2: Nav**

In `AdminLayout.tsx` add to `writeNavItems`:

```ts
{ to: '/admin/invite-quotas', labelKey: 'nav.inviteQuotas', permission: PERMISSIONS.INVITATIONS_QUOTA },
```

i18n: `"inviteQuotas": "Invite quotas"`.

- [ ] **Step 3: Build `InviteQuotasPage`**

Structure:
1. Header with month (`resort` + `current_period_ym` from first list payload) + mode badge.
2. Search input + filter chips.
3. Table of units from `list_resort_invite_quotas`.
4. Dialogs: HandOverDialog (defaults from `default_weekday`/`default_weekend`), AdjustDialog (add/remove).
5. Log section calling `list_invitation_quota_events`.

Match existing admin styling (`Button`, `Modal`, `Input` from `components/ui`).

Hand over button only if `resort.invitation_quota_mode === 'manual' && status === 'not_handed'`.
Add/Remove if automatic OR status === `handed`.

- [ ] **Step 4: `npm run build`** — pass.

- [ ] **Step 5: Manual UI check** on a manual resort: hand over → row status Handed → log row appears.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/InviteQuotasPage.tsx src/pages/admin/AdminLayout.tsx src/App.tsx src/i18n
git commit -m "feat(staff): invite quotas page with hand over, adjust, and log"
```

---

### Task 8: Remove Units page bonus controls

**Files:**
- Modify: `Resorts-Staff-App/src/pages/admin/UnitsPage.tsx`

- [ ] **Step 1: Remove** `canGrantBonus`, bonus modal state, `handleGrantBonus`, bonus buttons in the unit row menu, and the bonus Modal JSX.
- [ ] **Step 2: Keep** read-only allowance display (remaining/used) if already shown.
- [ ] **Step 3: Grep** for `grant_asset_invite_bonus` / `INVITATIONS_BONUS` under `src/` — should only remain in permissions expand or dead code removed.
- [ ] **Step 4: Build + commit**

```bash
git add src/pages/admin/UnitsPage.tsx
git commit -m "refactor(staff): move invite quota edits off Units page"
```

---

### Task 9: Owner app — types, access helpers, cabine non-tappable

**Files:**
- Modify: `Resortly/src/types/index.ts`
- Modify: `Resortly/src/lib/resortFields.ts`
- Modify: `Resortly/src/lib/unitAccess.ts`
- Modify: `Resortly/src/components/units/UnitCard.tsx`
- Modify: `Resortly/src/components/layout/ResortSync.tsx` (stub defaults if needed)

- [ ] **Step 1: Types**

Add `invitation_quota_mode?: 'automatic' | 'manual'` on Resort; include in `resortFields` select list.

- [ ] **Step 2: unitAccess**

Extend `UnitAccessState` with `{ status: 'not_handed' }` if needed for hub messaging — **or** keep access `active` and use allowance `handed: false` for invite gating. Prefer explicit:

```ts
export function isCabineInviteDisabled(asset, resort): boolean
export function isUnitTapDisabled(asset, resort): boolean // cabine + invites disabled
export function canShowInviteCounts(allowance, resort): boolean
export function canIssueInvitations(state, allowance?, resort?): boolean
  // false if cabine disabled, not_handed, exhausted, not active
```

Update `isUnitHubLocked`? Spec: cabine not tappable — handle in UnitCard, not hub lock.

- [ ] **Step 3: UnitCard**

```ts
const tapDisabled = isUnitTapDisabled(asset, asset.resorts)
function handleActivate() {
  if (locked || tapDisabled) return
  navigate(...)
}
```

When tapDisabled: no chevron, muted styles, `aria-disabled`. Still show label + type. Status line can reuse `cabineUnavailable`.

Hide `UnitAllowanceSummary` when manual and `allowance?.handed === false` (or unavailable).

- [ ] **Step 4: Build Resortly**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/resortFields.ts src/lib/unitAccess.ts src/components/units/UnitCard.tsx src/components/layout/ResortSync.tsx
git commit -m "feat(owner): lock cabine tap when invites disabled; hide unhanded counts"
```

---

### Task 10: Owner app — hub / issue / issuable lists for not-handed

**Files:**
- Modify: `Resortly/src/pages/units/UnitHubPage.tsx`
- Modify: `Resortly/src/pages/units/IssueInvitationPage.tsx`
- Modify: `Resortly/src/hooks/useIssuableUnits.ts`
- Modify: `Resortly/src/hooks/useIssueInvitation.ts` (map `NOT_HANDED` → i18n)
- Modify: `Resortly/src/i18n/locales/en.json` (+ fr/ar)
- Modify: `Resortly/src/App.tsx` if deep-link guard needed for cabine

- [ ] **Step 1: UnitHubPage**

- Do not render allowance card when `handed === false` in manual mode.
- `canInvite` requires handed (or automatic).
- Keep announce visitor when `canAnnounceVisitors`.
- Optional short note: `units.invitesNotHanded` — “Invitations are not available yet for this month.”

- [ ] **Step 2: IssueInvitationPage**

Early return if not handed / RPC would fail; deep link shows same message + back.

- [ ] **Step 3: useIssuableUnits**

Filter out units where allowance says not handed.

- [ ] **Step 4: Error map**

```ts
NOT_HANDED: 'errors.invitesNotHanded'
```

- [ ] **Step 5: Cabine deep link**

If user opens `/units/:id` for disabled cabine, show empty locked state or redirect to `/units` (match UnitCard policy).

- [ ] **Step 6: Build + manual check** on white-label or Resortly against manual resort.

- [ ] **Step 7: Commit**

```bash
git add src/pages/units src/hooks src/i18n src/App.tsx
git commit -m "feat(owner): block issue invitations until monthly quota hand over"
```

---

### Task 11: End-to-end acceptance

**Files:** none (verification only)

- [ ] **Step 1: Apply migration** to shared Supabase if not already.

- [ ] **Step 2: Run checklist from spec**

1. Superadmin → Manual → owner cannot issue / no counts until hand over.  
2. Hand over defaults → owner can issue.  
3. Add +1 and remove −1 each create log rows with username + unit + time.  
4. Simulate new month (temporarily set `period_ym` or advance `today_beirut` in a test DB) → not handed again.  
5. Automatic resort: no Hand over; Add/Remove works; Units has no bonus UI.  
6. Cabine invites off: card not tappable.  
7. Custom role without `invitations.quota` cannot open page; owner can.  
8. Existing issued invites survive quota wipe.

- [ ] **Step 3: Fix any failures** in follow-up commits (do not skip checklist items).

- [ ] **Step 4: Final commits** if polish needed; update spec status line to `Implemented` only after checklist passes.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Superadmin automatic/manual | 6 |
| Invite quotas page + role permission | 5, 7 |
| Audit log | 2, 7 |
| Cabine not tappable | 9, 10 |
| Manual not-handed: no counts / no issue / visitors OK | 3, 9, 10 |
| Month wipe + re-hand | 2–3 (lazy), 11 |
| Remove Units/Rentals bonus UI | 8 |
| Chalets + cabines handout | 2 list RPC |
| Mirror migrations | 1, 4 |
| Second hand_over rejected | 2 |
| Log every ±1 | 2 |

No TBD placeholders. RPC names consistent across tasks: `hand_over_asset_invite_quota`, `adjust_asset_invite_quota`, `list_resort_invite_quotas`, `list_invitation_quota_events`.
