# Task 7 Report: Invite Quotas page + nav + route

## Status

Implemented the permission-gated Invite Quotas admin experience for the staff app.

## Changes

- Added `InviteQuotasPage` with concurrent quota/activity loading and RPC payload error handling.
- Added label search and All, Not handed, Handed, Chalets, and Cabines filters.
- Added manual hand-over and add/remove quota modals with non-zero adjustment validation.
- Added the quota activity log with timestamp, username, action, unit, and weekday/weekend deltas.
- Added the `invitations.quota`-gated admin navigation item and route.
- Added English page strings and localized navigation labels in English, French, and Arabic.

## Verification

- `npm run build` — passed.
- `npx eslint "src/pages/admin/InviteQuotasPage.tsx"` — passed.
- `git diff --check` — passed.
- Full-repository `npm run lint` remains blocked by 24 pre-existing errors in unrelated files.

## Concerns

- French and Arabic page content uses the configured English fallback; only the navigation label is translated in this task.
