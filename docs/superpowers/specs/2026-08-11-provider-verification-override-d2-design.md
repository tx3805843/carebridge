# Increment D2: computed verification eligibility + governed override — design

**Date:** 2026-08-11
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic, Increment D2
**Tier:** Supervisor (CLAUDE.md — schema design, RLS policy authorship, credential-expiry/
auto-suspension logic)

## Context

Roadmap scope: "make `verified_profile`'s cron-computed booleans read-only in the UI; add a
separate governed override table/flow (reason, approver, effective period, audit) distinct
from computed eligibility — closes the review's P0 'manual toggle beside computed status'
finding." Source: UX review's `12-provider-detail.jpg` finding — manual toggles beside
cron-computed status, needing a governed-override flow behind reason/approver/effective
period/confirmation.

**A real gap in the roadmap's own framing, found during investigation**: only
`nmc_licensed` is actually cron-computed today (confirmed against
`supabase/functions/credential-expiry-cron/index.ts` — it touches only that one column).
`id_verified`, `background_checked`, and `training_current` have zero automated computation;
`apps/ops-console/app/providers/[id]/actions.ts#updateVerifiedProfile` lets staff hand-set
all four with no derivation behind three of them at all. Making "the cron-computed booleans"
read-only, taken literally, would only apply to one field.

**Scope decision (confirmed with the user)**: extend automated computation to all four
signals, reusing the evidence-derivation logic Increment D1 already built for display
(`apps/ops-console/lib/provider-verification-status.ts`) — ported to SQL as the *authoritative*
computation, with D1's TS module staying as-is for *display* purposes only (see UI section).
This also resolves a real risk D1's own final code review flagged: a row could show
"NMC — Missing" (evidence-derived) with no Blocked badge (verified_profile-derived) at the
same time, with nothing on the page explaining the two signals were computed independently.
Making `verified_profile` itself trustworthy (rather than a stale manual flag) narrows, though
doesn't eliminate, that gap — D1's follow-up about needing an on-page explanation for the
remaining zone-agnostic-Blocked-badge case stays logged separately.

## Data model

### New table: `verification_override`

```sql
create table verification_override (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider(id),
  signal text not null check (signal in ('id_verified', 'nmc_licensed', 'background_checked', 'training_current')),
  override_value boolean not null,
  reason text not null,
  effective_from timestamptz not null default now(),
  effective_until timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references "user"(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id),
  check (effective_until > effective_from)
);
```

`effective_until` is **mandatory** (confirmed with the user) — every override forces a
future re-review rather than becoming a silent permanent bypass of computed eligibility.
No separate `approved_by` column: `created_by` (standard guardrail column, defaults to
`auth.uid()`) *is* the approver, because RLS restricts who can insert one in the first place
(see RLS section) — same pattern C3 already established for `escalation.resolved_by` (the
resolver's identity, not a second approval column, because only an authorized resolver could
submit the resolution at all).

### `verified_profile`: unchanged schema, new write path

No column changes. What changes is *who/what* can write to it (see RLS).

### Recompute function

```sql
create function internal.recompute_verified_profile(target_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_nurse boolean;
  v_id_verified boolean;
  v_nmc_licensed boolean;
  v_background_checked boolean;
  v_training_current boolean;
begin
  select (r.slug = 'nurse') into v_is_nurse
  from provider p join "user" u on u.id = p.user_id join role r on r.id = u.role_id
  where p.id = target_provider_id;

  -- Each signal: does a currently-valid ('verified' status, expiry null or >= today) row
  -- exist? Unlike D1's TS module (which also distinguishes "expiring soon" for display),
  -- this boolean collapse doesn't need the 30-day warning window at all — a credential
  -- expiring in 20 days is still valid today, so it still reads true here.
  select exists (
    select 1 from identity_verification where provider_id = target_provider_id and status = 'verified'
  ) into v_id_verified;

  select (not v_is_nurse) or exists (
    select 1 from credential c
    join credential_type ct on ct.id = c.credential_type_id
    where c.provider_id = target_provider_id and ct.slug = 'nmc_pin_ain' and c.status = 'verified'
      and (c.expiry_date is null or c.expiry_date >= current_date)
  ) into v_nmc_licensed;
  -- Note: v_nmc_licensed defaults to true for non-nurses here (matches the pre-D2 cron's own
  -- behavior of never touching caregivers' nmc_licensed, and matches getBlockedReasons only
  -- ever checking nmcLicensed when isNurse is true — a caregiver's value is never read for
  -- gating). This is NOT the same as D1's UI "not_applicable" state, which is a display-only
  -- concept; the stored boolean has no way to represent a third state and doesn't need to.

  select exists (
    select 1 from background_check
    where provider_id = target_provider_id and status = 'verified'
      and (expires_at is null or expires_at >= now())
  ) into v_background_checked;

  select exists (
    select 1 from training_record where provider_id = target_provider_id
  ) into v_training_current;

  -- Active overrides replace the computed value for their signal, strictly (not merged).
  select coalesce(max((o.override_value)::int), v_id_verified::int)::boolean into v_id_verified
    from verification_override o
    where o.provider_id = target_provider_id and o.signal = 'id_verified'
      and o.revoked_at is null and now() between o.effective_from and o.effective_until;
  -- (repeated identically for nmc_licensed, background_checked, training_current)

  insert into verified_profile (provider_id, id_verified, nmc_licensed, background_checked, training_current)
  values (target_provider_id, v_id_verified, v_nmc_licensed, v_background_checked, v_training_current)
  on conflict (provider_id) do update set
    id_verified = excluded.id_verified,
    nmc_licensed = excluded.nmc_licensed,
    background_checked = excluded.background_checked,
    training_current = excluded.training_current;
end;
$$;
```

(The plan will spell out the full, exact SQL for all four signals' override-application —
the snippet above shows the pattern once rather than four times.)

`security definer`, deliberately unlike B3's `enforce_client_activation_ready` (`security
invoker`): B3's trigger only *reads* tables the calling staff user already has RLS access to.
This function must *write* `verified_profile` after RLS removes staff's direct UPDATE grant
on it (see RLS section) — it needs elevated privilege specifically to still make that write
happen regardless of which role's action triggered it.

### Trigger: recompute on evidence or override change

```sql
create function internal.trg_recompute_verified_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform internal.recompute_verified_profile(coalesce(new.provider_id, old.provider_id));
  return new;
end;
$$;

create trigger credential_recompute_verified_profile
  after insert or update on credential
  for each row execute function internal.trg_recompute_verified_profile();
-- (identical triggers on background_check, identity_verification, training_record,
-- verification_override — one shared function, five attachment points)
```

`AFTER INSERT OR UPDATE` only — no `DELETE`, because no delete path exists on any of these
five tables anywhere in the app today (confirmed: `providers/[id]/actions.ts` only ever
inserts). Scope decision, not an oversight; add `DELETE` if a delete path is ever built.

### Both new functions live in `internal` schema from creation, not moved after

This codebase already found and fixed the mistake of a `security definer` function sitting
in `public` — every function there is auto-exposed as a PostgREST RPC endpoint, reachable by
`anon`/`authenticated` directly, bypassing RLS entirely (`20260809180000_security_hardening.sql`,
findings against `is_staff`/`has_consent`/etc.). `internal.recompute_verified_profile`,
`internal.trg_recompute_verified_profile`, `internal.recompute_all_verified_profiles`, and
`internal.is_credentialing_approver` are all created directly in `internal` — not repeating
that mistake for new functions.

## RLS

```sql
create function internal.is_credentialing_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(internal.current_role_slug() in ('clinical_director', 'admin'), false)
$$;
```

`verification_override`:
- `SELECT`: `internal.is_staff() or internal.is_own_provider(provider_id)` — identical shape
  to `verified_profile`'s existing select policy (a provider can see their own override
  history).
- `INSERT`, `UPDATE` (the only path to revoke — set `revoked_at`/`revoked_by`): restricted to
  `internal.is_credentialing_approver()`. This is the actual governance gate, enforced at the
  database — not merely hidden in the UI for non-approvers.

`verified_profile`:
- Drop `verified_profile_write_staff` (currently `for all ... using is_staff()`) entirely.
- Keep `verified_profile_select_self_or_staff` unchanged.
- No policy grants any role INSERT/UPDATE/DELETE going forward. The only writer is
  `internal.recompute_verified_profile`, which bypasses RLS by design (`security definer`).
  This — not a UI checkbox removal — is what makes the booleans genuinely read-only: even a
  direct REST call attempting `PATCH /verified_profile` fails for every role, staff included.

## Cron / edge function changes

`supabase/functions/credential-expiry-cron/index.ts`:
- Step 1 (flag expiring-soon / auto-expire lapsed credentials) — **unchanged**. Its
  `UPDATE credential SET status = 'expired'` now also fires
  `credential_recompute_verified_profile`, correctly recomputing all four signals (not just
  NMC) synchronously, same transaction.
- Step 2 (its own hand-rolled NMC-eligibility recompute loop) — **deleted**. It's now
  redundant with, and a second independent implementation of, what the trigger already does
  correctly from Step 1's own update — exactly the "two sources of truth" pattern this whole
  epic has repeatedly had to fix (C1's shared helper, D1's dual-NMC-reading footnote).
- Step 3 (notify newly-suspended nurses) — **changed from computing to diffing**: snapshot
  `verified_profile.nmc_licensed` for every nurse *before* Step 1 runs its updates, let the
  trigger do its work synchronously as Step 1 executes, re-read `verified_profile` *after*,
  diff the two snapshots to find `true → false` transitions. Same notification behavior and
  audience (provider + coordinators), sourced from the trigger's output instead of a second
  parallel computation.

New pg_cron job, pure SQL, no `pg_net`/HTTP/edge-function hop (unlike the existing
`credential-expiry-daily` job, because this calls an in-database function directly, not an
edge function over HTTP):

```sql
create function internal.recompute_all_verified_profiles()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider record;
begin
  for v_provider in select id from provider loop
    perform internal.recompute_verified_profile(v_provider.id);
  end loop;
end;
$$;

select cron.schedule(
  'verification-override-sweep-daily',
  '23 3 * * *', -- shortly after credential-expiry-daily (03:17 UTC), same reasoning: off the top of the hour
  $$ select internal.recompute_all_verified_profiles(); $$
);
```

The migration's own final statement is `select internal.recompute_all_verified_profiles();`
— backfilling every existing `verified_profile` row (seed data or real) from actual evidence
immediately, rather than leaving pre-migration rows stale until the first evidence change or
the next day's sweep.

This exists for exactly one case the triggers can't catch: an override's `effective_until`
lapsing with no other evidence-table row changing that day. Everything else (a credential
expiring, a new background check landing, an override being created or revoked) is already
covered by the trigger, immediately, not waiting up to 24 hours for this sweep.

## UI (`apps/ops-console/app/providers/[id]/page.tsx`)

**"Verified profile" section**: the four `<input type="checkbox">` toggles and their
surrounding form (`updateVerifiedProfile`) are deleted. Replaced with a read-only badge
display reusing D1's `getProviderVerificationBadges`
(`apps/ops-console/lib/provider-verification-status.ts`) — the page already fetches
`identity_verification`/`credential`/`background_check`/`training_record` for its own
lower sections, so this is additive wiring, not new fetches. This is a deliberate, documented
duplication of derivation logic (TS for display, SQL for the authoritative write) — the same
tradeoff already accepted in this codebase for `EXPIRY_WARNING_DAYS` (duplicated between the
Deno cron and the TS module because they're different runtimes that can't share source).

**New "Overrides" section**: a `DataTable` of `verification_override` rows for this provider
(signal, value, reason, effective window, revoked-or-not, `created_by`'s name) plus a create
form (signal `<select>`, value `<select>` true/false, reason `<textarea>`, effective-from/
until date inputs) gated behind `ConfirmSubmitButton` — matches C3's governed-action pattern
(a consequential write shouldn't be a bare submit button). A revoke action (sets
`revoked_at`/`revoked_by = auth.uid()`) appears next to each currently-active override.

The form and revoke button are hidden client-side when the logged-in staff user's role isn't
`clinical_director`/`admin` — cosmetic only, per every prior increment's own lesson (C1, C3):
the real gate is `is_credentialing_approver()`'s RLS policy, so a non-approver who reaches the
server action directly (bypassed UI, replayed request, whatever) is still rejected by the
database, not just steered away by a hidden button.

`apps/ops-console/app/providers/[id]/actions.ts`: `updateVerifiedProfile` is deleted.
`createVerificationOverride(providerId, formData)` and
`revokeVerificationOverride(overrideId, formData)` are added, following this file's existing
action shape (parse `FormData`, validate, `redirect` with `?error=`/`?updated=` params on
failure/success).

## Out of scope

- Any change to how `getBlockedReasons`/`provider-eligibility.ts` reads `verified_profile` —
  unchanged; it already trusts `verified_profile.nmc_licensed`, which is now genuinely
  trustworthy instead of a stale manual flag, with zero changes needed at that call site.
- Any change to D1's `apps/ops-console/app/providers/page.tsx` (list page) — unaffected;
  it already reads evidence tables directly for display and `verified_profile.nmc_licensed`
  for the Blocked badge, both unchanged by this increment.
- A two-step approval workflow (propose → separate approve) — the review asked for "reason,
  approver, effective period, confirmation," which this reads as "the approver submits it
  themselves" (matching C3's resolver precedent), not a request/approve handoff between two
  people. Logged as a scope call, not silently assumed.
- Extending the override mechanism to any table/signal outside `verified_profile`'s four
  columns.
- Fixing D1's separately-logged follow-up about the Blocked badge's own on-page explanation —
  tracked independently in the roadmap, not folded into this increment's scope.

## Amendment (found during implementation review)

An independent database-correctness review of the first-draft migration (built from this
doc's illustrative SQL) caught four real defects, all fixed in the implementation plan's
final SQL — noted here since this doc's snippets above are now stale on these points:

- **Blocker**: `verified_profile.created_by` is `not null default auth.uid()`, but
  `auth.uid()` is null in every context that actually calls the recompute function (a raw
  migration session, the pg_cron sweep, `credential-expiry-cron`'s service-role calls) —
  `ON CONFLICT DO UPDATE`'s speculative insert evaluates NOT NULL against the full candidate
  row regardless of outcome, so this would have failed on the migration's own backfill call.
  Fixed by dropping NOT NULL on that column (matching `audit_log`/`credential_type`'s
  existing precedent for the identical reason).
- `id_verified`/`background_checked` were computed via `EXISTS (... status = 'verified' ...)`
  across *all* rows ever, not the latest one — since this app inserts a new evidence row on
  every re-check rather than updating in place, a single old verified row could keep a signal
  true forever even after a newer row disputes it. Fixed to match
  `provider-verification-status.ts`'s `latestByCreatedAt` exactly (latest-row-wins) for all
  three status-bearing signals, not just NMC.
- The override `UPDATE` RLS policy permitted a full-row rewrite (an approver could silently
  change `override_value`/`effective_until`/`reason` in place instead of revoking), and
  nothing enforced `effective_until` being in the future at creation time (only that the
  window was non-empty). Both fixed with two small `BEFORE` triggers (revoke-only column
  guard on `UPDATE`, future-date guard on `INSERT` — deliberately not a table `CHECK`, which
  would re-validate on every later revoke too).

See `docs/superpowers/plans/2026-08-11-provider-verification-override-d2.md` Task 1 for the
corrected, authoritative SQL.

## Verification plan

Same bar as every prior increment — real local Postgres, not just typechecked:

1. Migration dry-run (`pnpm --filter @carebridge/db migrate:dry-run`) clean.
2. Seed-data walkthrough: pick a nurse with a verified NMC credential (Adjoa Asante), confirm
   `verified_profile.nmc_licensed` is `true` purely from the migration's own backfill
   statement — zero manual action, zero waiting for a trigger or the next day's sweep.
3. Confirm the read-only claim for real: attempt a direct `PATCH` on `verified_profile` via
   the Supabase client as a `coordinator`-role user (not just removing the UI checkboxes) —
   confirm it's rejected by RLS, not merely absent from the UI.
4. Create an override as `clinical_director` (e.g. force `nmc_licensed = true` for
   Akosua Darko, the seeded nurse with a lapsed NMC credential), confirm `verified_profile`
   flips immediately (trigger-driven, no cron wait) and `/visits/new`'s eligibility check
   reflects it.
5. Attempt to create an override as `coordinator` (non-approver) — confirm RLS rejects the
   insert, not just that the UI hides the form.
6. Revoke the override, confirm `verified_profile` reverts to the computed value immediately.
7. Set an override's `effective_until` to the past via direct SQL (simulating time passing
   without touching evidence), run `recompute_all_verified_profiles()` manually, confirm
   `verified_profile` reverts — proving the sweep job's one real reason to exist.
8. Confirm `credential-expiry-cron`'s existing behavior is unchanged end-to-end: an
   about-to-lapse credential still gets flagged, a lapsed one still auto-expires and still
   notifies the right people, sourced from the trigger's recompute rather than the deleted
   Step 2.
9. `pnpm --filter ops-console typecheck` and `lint` clean.
