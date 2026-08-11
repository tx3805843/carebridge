# Increment D3: roster weekly coverage board by zone — design

**Date:** 2026-08-11
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic, Increment D3

## Context

Roadmap scope: "roster weekly coverage board by zone (workload, leave, conflicts, credential
state), keeping an accessible table alternative" (worker-tier, no schema).

Today `/roster` is a write-focused page: an assignment form (provider → zone → week) plus a
flat `DataTable` of every roster row ever created, ordered by `week_starting` descending, no
zone grouping and no week scoping. There is no read surface that answers "who's actually
covering each zone this week, and is anything wrong with that coverage" — D3 builds that
surface without touching the existing assignment form or its table.

## Data model (no schema change)

All four signals are computed from existing tables — `roster`, `zone`, `provider`
(`employment_status`, plus the same evidence tables D1's `provider-verification-status.ts`
already reads), and `visit`. No new table, no new column.

`roster.week_starting` is a free-form date with no week-boundary normalization anywhere in
this app (C1's design doc already logged this) — D3 does not change that. The board matches
`roster` rows where `week_starting` equals the selected week's date **exactly**, a different
concept from C1's/D1's "current zone = provider's single most-recent roster row, regardless
of week" (used for `/visits/new` eligibility and the Blocked badge elsewhere). D3 needs a
specific week's assignments, not "whatever's most recent."

## Week selection

`?week=YYYY-MM-DD` on the new route. Default when omitted: the latest `week_starting` value
present in the `roster` table (falls back to today's date if `roster` is empty). Prev/next
links shift the param by ±7 days; a small GET `<form>` with a `type="date"` input lets staff
jump to an arbitrary week directly — same idiom as D1's search box (plain GET form, no client
state, no new table).

## Zone coverage (the board's primary signal)

For the selected week, group `roster` rows by `zone_id`. A zone with **zero** rostered
providers that week is a coverage gap — the literal thing a weekly coverage board exists to
surface. Shown as a `StatusBadge` (`critical` variant, label "Coverage gap") on that zone's
card.

## Per-provider signals (workload / leave / conflicts / credential state)

For each provider rostered to a zone that week:

- **Workload** — count of that provider's `visit` rows with `scheduled_start` inside
  `[week_starting, week_starting + 7 days)`. Simple count, not scheduled hours — matches no
  existing "duration" concept anywhere else in this app.
- **Leave** — `provider.employment_status` (`active` / `on_leave` / `departed`) shown as its
  own `StatusBadge`, distinct from the Blocked badge below even though `getBlockedReasons`
  (see next) also folds `on_leave`/`departed` into its reason text — the roadmap names leave
  as its own dimension, and a coordinator scanning for "who's out" shouldn't have to parse
  Blocked's reason string to find it. New `EMPLOYMENT_STATUS_LABEL`/variant map
  (`active` → success, `on_leave` → warning, `departed` → neutral), same shape as
  `exceptions/constants.ts`'s existing `SEVERITY_BADGE_VARIANT`.
- **Conflicts** — a provider's `visit` rows within the same week window are pairwise-checked
  for time overlap (`start < otherEnd && end > otherStart`, the same overlap definition C2's
  `visit-form.tsx` already uses for its advisory double-booking warning — reimplemented here,
  not imported, since C2's check is shaped as "one new visit vs. existing ones" and this is
  "all pairs within a fetched set," a different call shape). A provider with ≥1 overlapping
  pair gets a "Double-booked (N)" flag next to their row. Advisory only, matching C2's own
  precedent that overlap is a warning, not a block.
- **Credential state** — the existing Blocked badge only (not the full four D1 signal
  badges): reuses `getBlockedReasons`/`ProviderEligibilityProfile` from
  `apps/ops-console/lib/provider-eligibility.ts` unmodified, with the target zone set to the
  zone card the provider is listed under (D1's own-zone-as-target trick — the zone-match
  branch is trivially satisfied since the provider is, by construction, rostered there this
  week). Keeps each board row to 3 badges instead of 6, appropriate for a zone-grouped
  overview rather than the detailed `/providers` list.

## Unrostered providers

A trailing section/card lists every `active`/`on_leave` provider with no `roster` row for the
selected week — directly relevant to a coverage board (an unrostered provider is a workload/
coverage fact, not just a credential one). Shows employment + Blocked badges; workload and
conflict columns render "—" (not fetched — no zone context to scope a visit-week query
against, and `/visits/new` already independently re-derives eligibility for any provider
regardless of this page). `departed` providers are excluded — a departed provider being
unrostered isn't a coverage gap, it's the expected state.

## Views: board (default) and accessible table

`?view=board|table`, URL-param-driven exactly like D1's filter chips — no client component,
no persisted preference.

- **Board** (`?view=board`, default): page-local zone cards — plain styled `<div>`s matching
  `/dashboard`'s existing ad hoc stat-tile pattern (this app has no shared card component
  beyond `EntitySummaryCard`, which is shaped for a single entity's header, not a grouped
  list — reusing it here would be a worse fit than following dashboard's own precedent of a
  page-local card). Each zone card: zone name, Coverage-gap badge if empty, one line per
  rostered provider (name, workload count, employment badge, Blocked badge, conflict flag).
  Trailing Unrostered-providers card.
- **Table** (`?view=table`): one `DataTable`, one row per zone×provider assignment for the
  week plus a synthetic row per unrostered provider (`zone` column shows "—"). Same five
  columns as the board (Zone / Provider / Workload / Employment / Blocked+Conflict) — this is
  the same computed data in `DataTable`'s existing real-`<table>` markup, not a second feature
  to keep in sync by hand; both views render from one shared array built once in the page
  component.

A small link from `/roster`'s `PageHeader` area to `/roster/coverage` (existing cross-link
idiom, e.g. B2's "Open client record" link).

## Architecture

New pure-logic module `apps/ops-console/lib/roster-coverage.ts`:

- `computeZoneCoverage(zones, rosterRows)` → per zone, the list of rostered provider ids and
  an `isGap` boolean.
- `countOverlappingPairs(visits: { start: string; end: string }[])` → number of overlapping
  pairs (0 = no conflict).
- `EMPLOYMENT_STATUS_LABEL` / `EMPLOYMENT_STATUS_VARIANT` maps.

No changes to `provider-eligibility.ts` or `provider-verification-status.ts` — both are
imported and reused exactly as-is.

New route `apps/ops-console/app/roster/coverage/page.tsx` (server component): fetches
zones/roster-for-week/providers/evidence-tables/visits-for-week in one `Promise.all`, builds
one shared per-provider-per-zone row array via the new module plus the two existing modules,
then renders either the board or the table from that same array depending on `?view=`.

## Out of scope

- Editing roster assignments from this page — read-only; `/roster`'s existing form still owns
  all writes.
- Scheduled-hours workload (visit count only, see above).
- Resolving roster against a visit's actual date (still C1's known, deliberate scope cut —
  D3 doesn't reopen it).
- Persisted (server-stored) view/week preference across sessions — URL-param only, matching
  every prior increment's "shareable URL, not a stored record" precedent.
- Any change to C2's own overlap-warning UI or logic.

## Verification plan

Same bar as prior increments — real local Postgres, not just typechecked:

1. Confirm a zone with zero roster rows for the selected week shows the Coverage-gap badge,
   and a zone with rostered providers does not.
2. Temporarily insert two overlapping `visit` rows for one seeded provider within the
   selected week; confirm the Double-booked flag and count appear, and that a non-overlapping
   provider shows none. Revert via `supabase db reset`.
3. Cross-check the Blocked badge's text for a known-blocked seeded provider against what
   `/providers` already shows for the same provider — must match exactly.
4. Confirm an unrostered active provider appears in the Unrostered section with workload/
   conflict shown as "—", and a departed provider does not appear there at all.
5. Confirm the board and table views render identical underlying data for the same week (spot
   check every zone/provider pairing present in one also appears in the other).
6. Confirm prev/next week links and the date-jump form correctly change `?week=` and the
   resulting data.
7. `pnpm --filter ops-console typecheck` and `lint` clean.
