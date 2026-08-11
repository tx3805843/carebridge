# Increment C2: scheduling-summary richness — design

**Date:** 2026-08-11
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic, Increment C2

## Context

Roadmap scope: "surface care-plan version, zone, required skill, and conflicts in the
scheduling summary before confirmation." Worker-tier, no schema change.

Investigating found two real gaps and one unmodeled concept:

- **No confirmation step exists today.** `/visits/new` is a single-shot form submit
  (`scheduleVisit`, hardened by C1's eligibility re-check) with no review step before the
  insert happens. The roadmap's "before confirmation" phrase presupposes a confirmation step
  that has to be added, not modified.
- **No conflict detection exists anywhere.** A provider can currently be double-booked into
  two overlapping visits with zero warning — `visit` has no uniqueness or overlap constraint,
  and no code anywhere checks for it.
- **"Required skill" has no backing entity.** Zero hits searching the schema, domain model
  docs, or architecture brief. Same situation Increment B3 hit with "supervisor review" and
  "approved care plan" — dropped from scope there with the reasoning documented rather than
  faked, and this increment makes the same call for the same reason.

## Scope decision: conflicts warn, don't block

Confirmed with the user directly (not assumed): a detected provider double-booking is
**advisory, not a hard gate**. The roadmap's own wording ("surface... conflicts") is visibility
language, not prevention language, and real cases exist where a brief overlap is a deliberate
coordinator choice (handoff between two providers). This is a genuine difference from C1's
eligibility check, which correctly does hard-block (an unlicensed or wrong-zone provider
should never be schedulable, full stop) — conflicts don't carry the same
safety/compliance weight, so a softer gate is the right one here, not a weaker version of the
same gate.

## Architecture

**1. Live summary panel (`visit-form.tsx`)** — a panel rendered below the form, populated
progressively as the coordinator fills fields in, matching the "recompute on `change`" idiom
already established by B1's onboarding wizard and C1's eligibility picker (no new pattern
introduced):

- Once a client is selected: shows the client's zone name and their current care plan
  ("effective `<date>`: `<summary excerpt>`"), or "No care plan yet" if none exists — an
  honest empty state, not hidden or silently skipped (this can genuinely happen; `scheduleVisit`
  already rejects the submit in that case, but the coordinator should see it before trying).
- Once client, provider, and both scheduled-start/scheduled-end fields are filled: adds a
  conflict check — does this provider have any other non-terminal visit
  (`status` in `scheduled`/`en_route`/`in_progress`) whose time range overlaps the one being
  entered? `completed`/`cancelled`/`missed` visits are excluded — they don't represent real
  occupied time. If found, a visible warning line names the clashing client and time, not just
  a boolean flag.

**2. Data (`page.tsx`)** — extends the existing per-client/per-provider precompute (same
`Promise.all` + `Map`-join shape C1 already established, no new query pattern) with two more
maps: `careplanByClientId` (the same "most recent by `effective_from`" row `scheduleVisit`
already independently selects server-side — read-only display of an already-existing
server-side truth, not a new business rule) and `visitsByProviderId` (each provider's
non-terminal visits' `scheduled_start`/`scheduled_end`, for the client-side overlap check).
Both computed at the same pilot-scale up-front pass C1's eligibility matrix already does — same
scaling note applies (fine now, would need revisiting at real scale).

**3. Confirmation** — "Schedule visit" becomes a `ConfirmSubmitButton` (the same
native-dialog-gated component already used for billing invoice generation, client
deactivate/reactivate, and escalation resolve — no new UI component). The dialog names the
client, provider, and time, and — if a conflict was detected — states it plainly ("This
provider already has a visit scheduled for `<other client>` at `<overlapping time>` — schedule
anyway?") so the warning is visible at the moment of commitment, not only somewhere above the
fold the coordinator may have scrolled past.

**4. Server** — no change to `scheduleVisit`'s actual logic. Care-plan version and zone are
read-only display of data the server already independently derives or trivially could; the
conflict check is advisory-only per the scope decision above, so there is no matching
server-side gate to add (a hard server check would contradict "warn, don't block" — nothing
here should silently upgrade an intentionally soft gate into a hard one).

## Out of scope

- "Required skill" — unmodeled, dropped, documented (see Context above).
- Any server-side conflict enforcement — deliberately advisory-only per the scope decision.
- Client-side (not provider-side) double-booking detection (two providers visiting the same
  client at overlapping times) — the roadmap line and the real operational risk here is
  provider double-booking (a person literally can't be in two places), not client
  double-booking (having two providers visit around the same time isn't inherently a problem);
  not built, not silently assumed impossible either — a real, smaller, deferred case.

## Verification plan

Same bar as prior increments — real local Postgres, not just typechecked:

1. Seed-data walkthrough: select a client with an existing care plan, confirm the panel shows
   the right effective date/summary text; the seed's care-plan rows are already known from
   prior increments' verification passes, reuse rather than fabricate new fixtures.
2. Select the eligible seeded provider (Adjoa Asante, per C1's verification) and pick a
   start/end time that overlaps her one existing scheduled visit (seed has one) — confirm the
   panel surfaces the conflict warning with the correct other-client name and time, and confirm
   the `ConfirmSubmitButton` dialog also states it.
3. Confirm submitting anyway still succeeds (the visit is created despite the conflict warning
   — proving this is genuinely advisory, not silently blocking).
4. Confirm a non-overlapping time shows no conflict warning at either the panel or the dialog.
5. `pnpm --filter ops-console typecheck` and `lint` clean.
