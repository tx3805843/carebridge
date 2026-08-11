# Increment D1: provider list/detail refresh — design

**Date:** 2026-08-11
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic, Increment D1

## Context

Roadmap scope: "provider list/detail refresh — explicit Verified/Missing/Not applicable/
Expiring/Blocked badges, search and saved filters" (worker-tier, no schema). Source: UX
review's `11-providers-list.jpg` finding — "Dense verification text relies on
checkmarks/dashes and ambiguous 'not applicable'; no search, credential risk, license
expiry, or schedule eligibility filter."

Today `/providers` shows four flat boolean badges (ID / NMC / Background / Training) sourced
directly from `verified_profile`'s four columns — no distinction between "never checked,"
"checked and expiring," or "doesn't apply to this role." No search or filtering exists at
all.

**Detail page (`/providers/[id]`) is explicitly out of scope for D1.** The review's
`12-provider-detail.jpg` finding — manual toggles beside cron-computed status, needing tabs
and a governed-override flow — is D2 (supervisor-tier, touches the credentialing/eligibility
boundary CLAUDE.md gates). Touching the detail page's verification section in D1 risks
double-touching code D2 is about to restructure. D1 is `/providers` (list) only.

## Data model (no schema change)

Badge state is computed from the underlying evidence tables, not from `verified_profile`'s
flags — `verified_profile` is a cron/manually-toggled summary (D2's concern to make
trustworthy); D1 derives directly from the evidence so the badges reflect real records even
where the summary flag might be stale (e.g. a background check that has quietly passed its
`expires_at` with nobody re-toggling the checkbox).

`EXPIRY_WARNING_DAYS = 30` is reused (duplicated as a constant, not imported — the cron runs
in a separate Deno edge function, not this Next.js app) to keep the "expiring soon" window
consistent with `credential-expiry-cron`.

| Signal | Verified | Missing | Not applicable | Expiring |
|---|---|---|---|---|
| **ID** | latest `identity_verification` row has `status = 'verified'` | no row, or latest row's status is `pending`/`rejected`/`unverified`/`expired` | never | never — no expiry field in schema |
| **NMC** | provider's role is `nurse`, and they hold a `credential` (type `nmc_pin_ain`) with `status = 'verified'` and (`expiry_date` is null or `expiry_date` ≥ today + 30d) | role is `nurse` and no such valid credential exists | role ≠ `nurse` (caregiver) | role is `nurse`, holds a verified NMC credential, and its `expiry_date` falls within [today, today + 30d] |
| **Background** | latest `background_check` row has `status = 'verified'` and (`expires_at` is null or `expires_at` ≥ today + 30d) | no row, or latest row not verified, or verified but `expires_at` already past | never | latest verified `background_check`'s `expires_at` falls within [today, today + 30d] |
| **Training** | at least one `training_record` row exists | no rows exist | never | never — no expiry field on `training_record` |

"Latest" always means most recent by `created_at` (matches the ordering the detail page
already uses for these same tables). ID and Training never show "Expiring" — the schema has
no expiry concept for either, so pretending otherwise would fabricate a signal that isn't
there.

## Overall "Blocked" badge (scheduling eligibility)

A fifth, provider-level (not per-signal) badge reusing C1's `getBlockedReasons` from
`apps/ops-console/lib/provider-eligibility.ts` unmodified:

```ts
getBlockedReasons(profile, profile.currentZone?.id ?? "")
```

Passing the provider's own current zone as the target trivially satisfies the zone-match
branch (it can never differ from itself), so the zone-mismatch reason never fires spuriously
on a page with no specific client/target zone in view — while a provider with **no** roster
row at all still correctly triggers "not yet rostered to any zone" (`undefined !== ""`).
This reuses tested logic exactly rather than forking a second copy, at the cost of one
additional fetch this page doesn't do today: `roster` rows, shaped into the existing
`RosterAssignment[]`/`getCurrentZoneId` shape C1 already established.

Shown as a `StatusBadge` reading "Blocked" with the reason(s) (semicolon-joined, matching
C1's existing wording) — via a `title` attribute for now, consistent with this app having no
tooltip component; nothing eligible shows no badge (keeps the row uncluttered — five badges
of state per provider is already dense).

## Architecture

New pure-logic module, same pattern as `provider-eligibility.ts`:
`apps/ops-console/lib/provider-verification-status.ts`, exporting one function per signal
(or one function returning all four) taking the already-fetched rows and returning the
derived state. Pure, synchronous, no Supabase client — testable by construction even though
this app has no unit test suite yet (verification is browser-based, see below, matching
every prior increment).

`/providers/page.tsx` fetches `identity_verification`, `background_check`, and
`training_record` for all listed providers (three new queries, batched via `.in(...)`
exactly like the existing `verified_profile` fetch) alongside the `roster` fetch for the
Blocked badge, then calls the new module per provider row.

## Search & filters

Server component, URL `searchParams`-driven — matching `exceptions/page.tsx`'s existing
`view` param convention exactly. No client component, no new table, no persistence across
sessions ("saved" in the sense of a shareable/bookmarkable URL, not a per-user stored
record):

- **Search**: a GET `<form>` with `name="q"`, matched as a case-insensitive substring against
  the provider's name (server-side `.includes()` over the already-fetched array — pilot-scale
  provider counts don't warrant a DB `ilike` round-trip).
- **Filter chips**: links setting `?filter=expiring | missing | blocked`, each carrying `q`
  forward if set. No `filter` param shows everyone.
  - `expiring` — any of the four per-signal badges is "Expiring".
  - `missing` — any of the four per-signal badges is "Missing".
  - `blocked` — the overall Blocked badge is present.

These three map directly to the review's own framing ("filters for renewal and onboarding
work" — expiring/missing serve onboarding follow-up, blocked serves renewal/scheduling
triage). A role filter (nurse/caregiver) is not added — role is already visible as a column
and the existing `<DataTable>` has no sort/group affordance to make a redundant filter chip
worthwhile.

## UI

Badge rendering swaps `flagBadge` (boolean → success/neutral `StatusBadge`) for a
5-state-aware version: `verified` → success, `expiring` → warning, `missing` → critical,
`not_applicable` → neutral (label "N/A" to keep the row compact), matching `StatusBadge`'s
existing variant vocabulary (used identically by the exception queue's severity badges).

## Out of scope

- Detail page (`/providers/[id]`) — D2, see Context above.
- Making `verified_profile`'s booleans read-only, or any governed-override flow — D2.
- Persisted (server-stored, cross-device) saved filters — not asked for beyond a shareable
  URL; would need a new table, which D1 explicitly excludes.
- Role filter chip — redundant with the existing Role column (see Search & filters above).
- Any change to `getBlockedReasons` itself, or to C1/C2/C3 pages that already call it.

## Verification plan

Same bar as prior increments — real local Postgres, not just typechecked:

1. Seed-data walkthrough: confirm at least one provider lands in each of the five states
   across the four signals (reuse the existing intentionally-lapsed NMC nurse from Phase 1
   seed data for "Expiring"/"Missing" on NMC; confirm a caregiver shows NMC = "Not
   applicable").
2. Browser: search by partial name, click each filter chip, confirm the resulting rows match
   the badges shown (no filter hides a row it should show, or vice versa).
3. Confirm the Blocked badge's reason text matches what `/visits/new` already shows for the
   same provider (proves the zone-as-own-target reuse didn't silently change the underlying
   logic's meaning).
4. `pnpm --filter ops-console typecheck` and `lint` clean.
