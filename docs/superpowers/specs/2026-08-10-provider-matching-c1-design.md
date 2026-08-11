# Increment C1: eligibility-aware provider matching — design

**Date:** 2026-08-10
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic, Increment C1

## Context

Roadmap scope: "eligibility-aware provider matching in `/visits/new` — filter to eligible
providers by default (roster zone match + `verified_profile.nmc_licensed` +
`employment_status = 'active'`), list blocked providers separately with the exact reason,
replacing today's reject-on-save behaviour." Worker-tier, no schema change — all three
signals already exist (`roster.zone_id`/`week_starting`, `verified_profile.nmc_licensed`,
`provider.employment_status`).

Investigating found the real gap this increment closes: `/visits/new` today has **zero**
provider-eligibility checking anywhere. `visit-form.tsx`'s provider `<select>` lists every
provider unconditionally, and `scheduleVisit` (`actions.ts`) only checks care-plan existence
and (post-B3) client-active status. A suspended/unlicensed nurse, a departed provider, or
someone never rostered to the client's zone can be scheduled today with no rejection at all —
the review mockup's "reject-on-save" framing describes the *intended* behavior this increment
builds, not something that currently exists on this page (the one real reject-on-save guard in
this codebase, the NMC check, lives on roster assignment, not visit scheduling).

A second real gap surfaced during design: `roster.week_starting` is a free-form date the
coordinator picks — there's no week-boundary normalization anywhere in this app, so "current
zone assignment" has no existing precedent. The most literal reading ("as of the visit's
scheduled date") would make eligibility depend on *two* not-yet-selected form fields (which
client, and what date) simultaneously, which the current single-page-load architecture can't
support without a new fetch mechanism. Scoped down to: a provider's current zone = their
single most-recent roster row by `week_starting`, independent of the visit's date — matching
how `/roster` itself already presents "current" (just the latest row, no date-of-visit
reasoning exists anywhere else in this app). The date-aware version is a real but unbuilt
enhancement, not silently assumed away.

## Data model (no schema change)

Eligibility for a given (client, provider) pair is computed from three signals, none of
which require a new column:

- **Roster zone match**: provider's current zone = the roster row with `max(week_starting)`
  across all their roster rows (there can be many, one per week per zone they've ever been
  assigned to). Blocked if that zone differs from the client's `zone_id`, or if the provider
  has no roster row at all.
- **License**: `verified_profile.nmc_licensed`, checked only for providers whose role is
  `nurse` (matches the existing `roster/actions.ts#addRosterAssignment` guard's own scoping —
  caregivers have no equivalent statutory credential per CLAUDE.md).
- **Employment**: `provider.employment_status = 'active'` (blocks `on_leave`/`departed`).

A provider can fail more than one of these at once; all applicable reasons are surfaced
together, not just the first one found.

## Architecture: precomputed matrix, client-side filter

`/visits/new` is a single page load with no client-driven refetch anywhere in this app (no
API routes, no client components that call Supabase directly) — eligibility depends on which
client is selected, but the client picker and provider picker are both on the same static
form. Two options considered:

1. **Reload on client selection** (server round-trip per client pick) — simplest
   server-side, but a worse UX regression (page reload to see providers) than what exists
   today, and inconsistent with this app's existing single-submit form patterns.
2. **Precompute the full matrix server-side, filter client-side** (chosen) — at pilot scale
   (5 clients × 6 providers today), computing eligibility for every client×provider pair on
   page load costs nothing meaningful, and matches the exact pattern the onboarding wizard
   (B1) already established: a `FormData`/plain-JS snapshot recomputed on `change`, no server
   round-trip. Noted as a real scaling limit, not silently ignored — this approach becomes
   wasteful at large client/provider counts and would need revisiting (e.g. an API route
   computing eligibility for one selected client) if this app ever operates beyond pilot
   scale.

`page.tsx` computes a matrix: `Record<clientId, { eligible: ProviderOption[]; blocked:
{ provider: ProviderOption; reasons: string[] }[] }>` and passes it to `visit-form.tsx` (an
already-`"use client"` component) as a prop.

## UI

The provider `<select>` starts disabled with a placeholder option "Select a client first" —
today it's populated with zero context before a client is even chosen, which this increment
also fixes as a direct, minimal consequence of client-driven filtering (not separate scope).
Once a client is selected (`onChange` on the client `<select>`), the provider `<select>` is
enabled and repopulated from the matrix using two native `<optgroup>`s:

- `<optgroup label="Eligible">` — plain provider name, selectable, exactly like today.
- `<optgroup label="Blocked">` — `disabled` `<option>`s, with reason(s) appended to the label
  text, e.g. `"Kwame Mensah — NMC PIN/AIN not licensed"` or `"Ama Serwaa — on leave; rostered
  to Dansoman"` for multiple reasons joined with `; `.

Native `<optgroup>`/`disabled option` matches this app's existing plain-`<select>` idiom
(no combobox component exists in `@carebridge/ui`) — no new UI component needed.

## Server-side backstop

`scheduleVisit` gets the same three checks re-derived server-side, inserted after the
existing client-status check and before the care-plan lookup — matching the file's own
established shape (every existing guard is re-derive-then-reject, never a check that trusts
what the client-side UI already filtered). Reuses the same reason-building logic as the page
computation (extracted as a small shared helper so the wording can't drift between the UI's
blocked-option labels and the server's rejection message) rather than duplicating the logic
inline in two places.

## Out of scope

- Date-aware roster matching (checking the roster as it will stand on the visit's actual
  date, not just "most recent right now") — logged above as a real, deliberately unbuilt
  enhancement.
- Everything else the review mockup's scheduling screen describes beyond the roadmap's C1
  line (workload, continuity of care, travel fit, availability/conflict detection) — conflict
  detection specifically is Increment C2's stated scope ("surface care-plan version, zone,
  required skill, and conflicts in the scheduling summary"), not C1's.
- Any change to `addRosterAssignment`'s existing nurse-licensing guard — unchanged, this
  increment only adds an equivalent (but broader — also zone + employment) check at
  scheduling time.

## Verification plan

Same bar as prior increments — real local Postgres, not just typechecked:

1. Seed-data walkthrough: confirm the matrix correctly sorts at least one provider into each
   blocked reason (the seed already has an intentionally-lapsed NMC nurse from Phase 1 — reuse
   it rather than fabricating new fixtures) plus at least one fully eligible provider per
   client.
2. Browser: select a client, confirm the provider dropdown shows the right eligible/blocked
   split with correct reason text, confirm blocked options are genuinely unselectable
   (disabled, not just visually greyed).
3. Attempt to bypass the UI and submit a blocked provider directly against the server action
   (e.g. via a raw form-data POST or by temporarily removing the `disabled` attribute in
   devtools) — confirm `scheduleVisit` rejects it with the same reason text, proving the
   server check is real and not just present in the UI.
4. `pnpm --filter ops-console typecheck` and `lint` clean.
