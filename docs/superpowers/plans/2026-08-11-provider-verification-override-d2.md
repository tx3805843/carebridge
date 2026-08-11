# Computed Verification Eligibility + Governed Override (Increment D2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All four `verified_profile` booleans (`id_verified`, `nmc_licensed`,
`background_checked`, `training_current`) become genuinely computed from evidence tables and
read-only in the UI — no more staff hand-toggling. A new `verification_override` table lets
`clinical_director`/`admin` staff temporarily override a computed value (mandatory reason,
mandatory effective-until date), enforced by RLS, not just hidden UI. `credential-expiry-cron`
loses its own duplicate NMC-eligibility computation in favor of the same shared mechanism.

**Architecture:** One supervisor-tier migration: a new table, a `security definer` recompute
function that derives all four booleans from evidence + any active override and writes them
into `verified_profile`, and a generic trigger firing that function on every write to
`credential`/`background_check`/`identity_verification`/`training_record`/
`verification_override`. `verified_profile`'s staff write policy is dropped entirely — the
recompute function becomes the only writer. Then: an edit to the Deno edge function to stop
duplicating the computation, and two ops-console file edits (server actions, detail page UI).

**Tech Stack:** Supabase CLI (local Postgres via `supabase db reset`), plain SQL migrations
(plpgsql functions, triggers, RLS, `pg_cron`), Deno (`credential-expiry-cron`), Next.js server
actions + Supabase JS client. No SQL unit-test framework in this project — every migration is
verified via `supabase db reset` + `pnpm --filter @carebridge/db rls:check` + direct
role-impersonation SQL against real local Postgres (same pattern as
`docs/superpowers/plans/2026-08-10-client-activation-b3.md`), plus a real browser walkthrough
for the UI tasks.

**Spec:** `docs/superpowers/specs/2026-08-11-provider-verification-override-d2-design.md`

---

### Task 1: Write the migration

**Files:**
- Create: `supabase/migrations/20260811090000_provider_verification_override.sql`

- [ ] **Step 1: Write the complete migration file**

```sql
-- Increment D2 — makes verified_profile's four booleans genuinely computed from evidence
-- (today only nmc_licensed has any automation at all; id_verified/background_checked/
-- training_current are pure staff-toggled flags) and read-only in the UI, and adds a
-- governed override table for clinical_director/admin to temporarily correct a computed
-- value. Supervisor-tier per CLAUDE.md (schema design, RLS authorship, credential-expiry/
-- auto-suspension logic). See
-- docs/superpowers/specs/2026-08-11-provider-verification-override-d2-design.md for full
-- rationale; this comment covers only what a future reader of this file needs.
--
-- Design note (write-through recompute, not a read-time join): every existing reader of
-- verified_profile (apps/ops-console/app/visits/new/page.tsx,
-- apps/ops-console/app/providers/page.tsx's Blocked badge, credential-expiry-cron) keeps
-- reading it exactly as before — zero changes needed at those call sites. The alternative
-- (join overrides at read time in every consumer) would have spread the same resolution
-- logic across 3+ files, the exact "two sources of truth" pattern this epic has repeatedly
-- had to fix (C1's shared helper, D1's dual-NMC-reading footnote).
--
-- Design note (security definer, unlike B3's enforce_client_activation_ready which is
-- invoker): B3's trigger only reads tables the calling staff user already has RLS access to.
-- recompute_verified_profile must WRITE verified_profile after this migration removes
-- staff's direct UPDATE grant on it (below) — it needs elevated privilege specifically to
-- still make that write happen regardless of which role's action triggered it.
--
-- Design note (new functions created directly in `internal`, not moved after): this
-- codebase already found and fixed a security-definer function sitting in `public` being
-- directly callable as a PostgREST RPC, bypassing RLS entirely
-- (20260809180000_security_hardening.sql). Not repeating that mistake. Every internal.*
-- reference below is fully schema-qualified inside function bodies — this codebase also
-- already found and fixed a bug from an unqualified reference silently resolving against the
-- wrong schema after a function moved (20260809200000_fix_is_staff_internal_reference.sql).

-- ── verification_override ────────────────────────────────────────────────────────────

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

create index verification_override_provider_id_idx on verification_override (provider_id);

create trigger verification_override_set_updated_at
  before update on verification_override
  for each row execute function public.set_updated_at();

-- ── Integrity triggers: mandatory-future-at-creation, revoke-only after creation ───────
-- Two separate triggers, deliberately: the future-date rule only makes sense at INSERT time
-- (a CHECK constraint using now() would re-validate on every UPDATE too, which would then
-- reject the legitimate revoke of an override whose effective_until has since passed — a
-- normal, expected case). The revoke-only rule only makes sense at UPDATE time.

create function internal.enforce_verification_override_future_effective_until()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.effective_until <= now() then
    raise exception 'verification_override.effective_until must be in the future at creation time (got %)', new.effective_until;
  end if;
  return new;
end;
$$;

create trigger verification_override_enforce_future_effective_until
  before insert on verification_override
  for each row execute function internal.enforce_verification_override_future_effective_until();

-- Without this, verification_override_update_approver's RLS (below) would let any approver
-- rewrite an existing override's override_value/effective_until/reason in place via a plain
-- UPDATE — silently changing a governance decision rather than revoking it and creating a
-- new one, undermining the audit trail this table exists to provide.

create function internal.enforce_verification_override_revoke_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.provider_id is distinct from old.provider_id
    or new.signal is distinct from old.signal
    or new.override_value is distinct from old.override_value
    or new.reason is distinct from old.reason
    or new.effective_from is distinct from old.effective_from
    or new.effective_until is distinct from old.effective_until
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'verification_override rows can only be revoked (revoked_at/revoked_by), not otherwise modified';
  end if;
  return new;
end;
$$;

create trigger verification_override_enforce_revoke_only
  before update on verification_override
  for each row execute function internal.enforce_verification_override_revoke_only();

-- ── internal.is_credentialing_approver() ────────────────────────────────────────────────
-- Stricter subset of internal.is_staff() (coordinator/clinical_director/admin) — matches
-- this codebase's existing precedent for safety/credentialing-adjacent actions
-- (CRITICAL_RESOLVER_ROLE_SLUGS in apps/ops-console/app/exceptions/constants.ts already
-- restricts critical-escalation resolution to exactly these two roles).

create function internal.is_credentialing_approver()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(internal.current_role_slug() in ('clinical_director', 'admin'), false)
$$;

-- ── RLS: verification_override ──────────────────────────────────────────────────────────

alter table verification_override enable row level security;

create policy verification_override_select_self_or_staff on verification_override
  for select
  to authenticated
  using (internal.is_staff() or internal.is_own_provider(provider_id));

create policy verification_override_write_approver on verification_override
  for insert
  to authenticated
  with check (internal.is_credentialing_approver());

create policy verification_override_update_approver on verification_override
  for update
  to authenticated
  using (internal.is_credentialing_approver())
  with check (internal.is_credentialing_approver());

-- No delete POLICY — RLS default-denies delete for the `authenticated` role (no permissive
-- policy matches). Overrides are corrected by revoking (an update setting
-- revoked_at/revoked_by, enforced revoke-only by the trigger above), never erased through the
-- app. This guarantee is scoped to RLS-governed `authenticated` access: `service_role` has
-- BYPASSRLS and is still granted DELETE below (matching every other table's uniform grant in
-- this schema) — that's the trusted backend key, never exposed to end users, not a gap in the
-- app-facing guarantee.

create trigger verification_override_audit after insert or update or delete on verification_override for each row execute function internal.audit_row_change();

grant select, insert, update, delete on verification_override to authenticated;
grant select, insert, update, delete on verification_override to service_role;

-- ── verified_profile.created_by: drop NOT NULL ──────────────────────────────────────────
-- verified_profile is now exclusively system-computed (see recompute function below) — no
-- write ever originates from a specific staff action anymore, so created_by can never be
-- populated by auth.uid(). auth.uid() reads request.jwt.claim.sub, which is null in every
-- context that actually calls the recompute function: a raw migration/psql session (this
-- migration's own backfill call below), the pg_cron sweep, and credential-expiry-cron's
-- service-role-authenticated update (no JWT sub claim at all). Postgres evaluates NOT NULL
-- against the full candidate row during `ON CONFLICT DO UPDATE`'s speculative insert
-- regardless of which branch is ultimately taken, so a NOT NULL created_by with only a
-- `default auth.uid()` would fail this statement every time — including its own first
-- backfill call. Matches the existing precedent of audit_log/credential_type's created_by
-- already being nullable for the identical reason ("a system-driven change has no
-- auth.uid()", 20260809173000).

alter table verified_profile alter column created_by drop not null;

-- ── internal.recompute_verified_profile(uuid) ───────────────────────────────────────────
-- The single authoritative computation of all four verified_profile booleans. Ported from
-- apps/ops-console/lib/provider-verification-status.ts's per-signal derivation (built for
-- D1's list-page display) — deliberately duplicated here in SQL rather than shared, since
-- triggers can't call TypeScript. This boolean collapse is simpler than D1's 4-state TS
-- version: D1 also distinguishes "expiring soon" for display, but a credential expiring in
-- 20 days is still valid today, so the stored boolean only needs "is there a currently-valid
-- row" — no 30-day window here at all.

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
  v_override record;
begin
  select coalesce(r.slug = 'nurse', false) into v_is_nurse
  from provider p
  join "user" u on u.id = p.user_id
  join "role" r on r.id = u.role_id
  where p.id = target_provider_id;

  -- Latest-row-wins for every signal with a status field, matching
  -- apps/ops-console/lib/provider-verification-status.ts's latestByCreatedAt exactly — a
  -- newer non-verified row (e.g. a failed re-check) must override an older verified one,
  -- since identity_verification/background_check/credential rows are inserted, never updated
  -- in place, by this app's own server actions (an EXISTS-across-all-rows check would let a
  -- single old verified row keep a signal true forever, even after a newer row disputes it).
  select coalesce((
    select status = 'verified'
    from identity_verification
    where provider_id = target_provider_id
    order by created_at desc
    limit 1
  ), false) into v_id_verified;

  -- Non-nurses default to true here (never gates anything — getBlockedReasons in
  -- provider-eligibility.ts only ever checks nmcLicensed when isNurse is true — this matches
  -- the pre-D2 cron's own behavior of never touching caregivers' nmc_licensed). This is NOT
  -- D1's UI "not_applicable" display state — the stored boolean has no third state and
  -- doesn't need one.
  select coalesce(v_is_nurse, false) = false or coalesce((
    select c.status = 'verified' and (c.expiry_date is null or c.expiry_date >= current_date)
    from credential c
    join credential_type ct on ct.id = c.credential_type_id
    where c.provider_id = target_provider_id and ct.slug = 'nmc_pin_ain'
    order by c.created_at desc
    limit 1
  ), false) into v_nmc_licensed;

  select coalesce((
    select status = 'verified' and (expires_at is null or expires_at >= now())
    from background_check
    where provider_id = target_provider_id
    order by created_at desc
    limit 1
  ), false) into v_background_checked;

  select exists (
    select 1 from training_record where provider_id = target_provider_id
  ) into v_training_current;

  -- Active, non-revoked overrides strictly replace the computed value for their signal. If a
  -- provider somehow has more than one active override on the same signal, the most
  -- recently-created one wins — same "latest row wins" idiom used throughout this codebase
  -- (D1's latestByCreatedAt, roster's getCurrentZoneId).
  for v_override in
    select distinct on (signal) signal, override_value
    from verification_override
    where provider_id = target_provider_id
      and revoked_at is null
      and now() between effective_from and effective_until
    order by signal, created_at desc
  loop
    if v_override.signal = 'id_verified' then
      v_id_verified := v_override.override_value;
    elsif v_override.signal = 'nmc_licensed' then
      v_nmc_licensed := v_override.override_value;
    elsif v_override.signal = 'background_checked' then
      v_background_checked := v_override.override_value;
    elsif v_override.signal = 'training_current' then
      v_training_current := v_override.override_value;
    end if;
  end loop;

  -- created_by is deliberately omitted from both the column list and the update SET clause —
  -- it stays null (see the ALTER above), since this row is always system-computed, never a
  -- specific staff action.
  insert into verified_profile (provider_id, id_verified, nmc_licensed, background_checked, training_current)
  values (target_provider_id, v_id_verified, v_nmc_licensed, v_background_checked, v_training_current)
  on conflict (provider_id) do update set
    id_verified = excluded.id_verified,
    nmc_licensed = excluded.nmc_licensed,
    background_checked = excluded.background_checked,
    training_current = excluded.training_current;
end;
$$;

-- ── Trigger: recompute on every evidence or override change ────────────────────────────
-- AFTER INSERT OR UPDATE only — no DELETE, because no delete path exists on any of these
-- five tables anywhere in the app today. Scope decision, not an oversight.

create function internal.trg_recompute_verified_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform internal.recompute_verified_profile(coalesce(new.provider_id, old.provider_id));
  return coalesce(new, old);
end;
$$;

create trigger credential_recompute_verified_profile
  after insert or update on credential
  for each row execute function internal.trg_recompute_verified_profile();

create trigger background_check_recompute_verified_profile
  after insert or update on background_check
  for each row execute function internal.trg_recompute_verified_profile();

create trigger identity_verification_recompute_verified_profile
  after insert or update on identity_verification
  for each row execute function internal.trg_recompute_verified_profile();

create trigger training_record_recompute_verified_profile
  after insert or update on training_record
  for each row execute function internal.trg_recompute_verified_profile();

create trigger verification_override_recompute_verified_profile
  after insert or update on verification_override
  for each row execute function internal.trg_recompute_verified_profile();

-- ── internal.recompute_all_verified_profiles() + daily sweep ───────────────────────────
-- Exists for exactly one case the triggers above can't catch: an override's effective_until
-- lapsing with no other evidence-table row changing that day. Pure SQL, no pg_net/HTTP hop
-- needed (unlike credential-expiry-daily, which calls an edge function over HTTP) — this
-- calls an in-database function directly.

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
  '23 3 * * *', -- shortly after credential-expiry-daily (03:17 UTC), same off-the-hour reasoning
  $$ select internal.recompute_all_verified_profiles(); $$
);

-- ── verified_profile: drop the staff write policy ───────────────────────────────────────
-- The only writer going forward is internal.recompute_verified_profile (security definer,
-- bypasses RLS by design). No policy grants any role INSERT/UPDATE/DELETE — this, not a UI
-- checkbox removal, is what makes the booleans genuinely read-only: even a direct REST PATCH
-- attempt fails for every role, staff included.

drop policy verified_profile_write_staff on verified_profile;

-- ── Backfill ─────────────────────────────────────────────────────────────────────────────
-- Every existing verified_profile row (seed data or real) gets recomputed from actual
-- evidence immediately, rather than staying stale until the first evidence change or the
-- next day's sweep.

select internal.recompute_all_verified_profiles();
```

- [ ] **Step 2: Confirm the migration filename sorts after the last existing migration**

Run: `ls supabase/migrations | sort | tail -3`
Expected: `20260811090000_provider_verification_override.sql` is the last line.

---

### Task 2: Apply and verify the migration locally

**Files:** none (verification only)

- [ ] **Step 1: Migration dry-run**

Run: `pnpm --filter @carebridge/db migrate:dry-run`
Expected: passes clean — this is the CLAUDE.md-mandated check ("required before any
migration merges") and CI's own gate; run it before anything else in this task.

- [ ] **Step 2: Reset the local database**

Run: `supabase db reset`
Expected: all migrations apply cleanly, including the new one, with no errors.

- [ ] **Step 3: Run the RLS-coverage check**

Run: `pnpm --filter @carebridge/db rls:check`
Expected: passes, now covering the new `verification_override` table (table count increases
by exactly one from before this migration).

- [ ] **Step 4: Confirm the new objects exist**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d verification_override"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select tgname from pg_trigger where tgrelid = 'credential'::regclass and not tgisinternal;"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select proname, pronamespace::regnamespace from pg_proc where proname in ('recompute_verified_profile', 'recompute_all_verified_profiles', 'is_credentialing_approver', 'trg_recompute_verified_profile');"
```

Expected: `verification_override` table described with all columns; `credential`'s trigger
list includes `credential_recompute_verified_profile` alongside the pre-existing
`credential_audit`; all four new functions report `pronamespace = internal`.

- [ ] **Step 5: Confirm the backfill actually ran**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select provider_id, id_verified, nmc_licensed, background_checked, training_current from verified_profile order by provider_id;"
```

Expected: matches D1's own ground-truth grid
(`docs/superpowers/plans/2026-08-11-provider-refresh-d1.md`, Task 4's table) collapsed to
booleans — in particular `c0000000-0000-0000-0000-000000000001` (Adjoa Asante) is `true`
across all four, `c0000000-0000-0000-0000-000000000003` (Akosua Darko) has `nmc_licensed =
false` (her only NMC credential is `status = 'expired'`), and every caregiver
(`c0000000-...-04/05/06`) has `nmc_licensed = true` (the non-nurse default, matching the
pre-D2 cron's own behavior of never restricting caregiver scheduling on this field).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811090000_provider_verification_override.sql
git commit -m "D2: verification_override table + write-through recompute + RLS"
```

---

### Task 3: Role-impersonation verification of the recompute + override RLS

**Files:** none (verification only, via SQL against the local Postgres instance)

This is the supervisor-tier part of the increment — verified directly against Postgres, not
just exercised through the app. Same `begin; set local role authenticated; set local
request.jwt.claims = '{"sub": "<user-id>"}'; ...; commit;` wrapper as
`docs/superpowers/plans/2026-08-10-client-activation-b3.md` Task 3 — `set local` only lasts
the current transaction, so every step below stays wrapped in its own `begin`/`commit`.
Seeded users: `a0000000-0000-0000-0000-000000000001` (coordinator1, non-approver),
`a0000000-0000-0000-0000-000000000003` (director@carebridge.dev, Dr. Efua Mensah,
clinical_director — an approver). Target provider throughout:
`c0000000-0000-0000-0000-000000000003` (Akosua Darko, the seeded nurse with a lapsed NMC
credential — `nmc_licensed = false` per Task 2 Step 4's backfill confirmation).

- [ ] **Step 1: Confirm a direct write to `verified_profile` is rejected for every role**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000001"}';
update verified_profile set nmc_licensed = true where provider_id = 'c0000000-0000-0000-0000-000000000003';
select nmc_licensed from verified_profile where provider_id = 'c0000000-0000-0000-0000-000000000003';
rollback;
SQL
```

Expected: the `update` affects **0 rows** (RLS silently filters it out — no matching policy
grants write, so the `UPDATE`'s `WHERE` clause matches nothing from this role's perspective;
this is the correct Postgres RLS behavior for "no permissive policy," not an error). The
`select` still shows `false`, confirming nothing changed. Repeat the same block with
`a0000000-0000-0000-0000-000000000003` (clinical_director) substituted in — expect the
identical "0 rows affected" result, proving this is genuinely nobody's write path anymore,
not merely restricted to non-approvers.

- [ ] **Step 2: Confirm a non-approver cannot create an override**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000001"}';
insert into verification_override (provider_id, signal, override_value, reason, effective_until)
values ('c0000000-0000-0000-0000-000000000003', 'nmc_licensed', true, 'test', now() + interval '30 days');
rollback;
SQL
```

Expected: fails with an RLS policy violation error (`new row violates row-level security
policy for table "verification_override"`), confirming `coordinator1` (non-approver) is
rejected at the database, not merely by a hidden UI form.

- [ ] **Step 3: Confirm an approver can create an override and it takes effect immediately**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000003"}';
insert into verification_override (provider_id, signal, override_value, reason, effective_until)
values ('c0000000-0000-0000-0000-000000000003', 'nmc_licensed', true, 'Phone-verified renewal pending paperwork', now() + interval '30 days')
returning id;
commit;
SQL
```

Note the returned `id` as `TEST_OVERRIDE_ID` (export it — later steps interpolate it into new
heredocs, same pattern as B3's `TEST_CLIENT_ID`). Then, in a fresh connection (proving the
trigger already ran synchronously within the INSERT's own transaction, not needing this
second connection to do anything):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select nmc_licensed from verified_profile where provider_id = 'c0000000-0000-0000-0000-000000000003';"
```

Expected: `true` — flipped immediately by the trigger, no cron wait.

- [ ] **Step 4: Confirm revoking reverts it immediately**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000003"}';
update verification_override set revoked_at = now(), revoked_by = 'a0000000-0000-0000-0000-000000000003' where id = '$TEST_OVERRIDE_ID';
commit;
SQL
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select nmc_licensed from verified_profile where provider_id = 'c0000000-0000-0000-0000-000000000003';"
```

Expected: `false` again — reverted to the computed value the instant the override was
revoked.

- [ ] **Step 5: Confirm the sweep job catches a lapsed `effective_until` with no other change**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000003"}';
insert into verification_override (provider_id, signal, override_value, reason, effective_from, effective_until)
values ('c0000000-0000-0000-0000-000000000003', 'nmc_licensed', true, 'Sweep test', now() - interval '2 days', now() - interval '1 day')
returning id;
commit;
SQL
```

Note the returned `id` as `TEST_SWEEP_OVERRIDE_ID`. This override's window already lapsed at
insert time (`effective_until` is in the past), so the INSERT's own trigger firing should
already leave `verified_profile` at the computed value (`false`) — confirm that first:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select nmc_licensed from verified_profile where provider_id = 'c0000000-0000-0000-0000-000000000003';"
```

Expected: `false` (the trigger already correctly ignored the lapsed override on insert — this
step mainly documents that inserting a pre-lapsed override is a no-op, not a real test of the
sweep's *reason to exist*, which is catching a window lapsing with zero new writes; run the
sweep function directly anyway to confirm it's idempotent and doesn't error):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select internal.recompute_all_verified_profiles();"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select nmc_licensed from verified_profile where provider_id = 'c0000000-0000-0000-0000-000000000003';"
```

Expected: no error, `nmc_licensed` still `false`.

- [ ] **Step 6: Clean up and reset to clean seed state**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000003"}';
delete from verification_override where id in ('$TEST_OVERRIDE_ID', '$TEST_SWEEP_OVERRIDE_ID');
commit;
SQL
```

Then run: `supabase db reset` (returns to clean seed state for the next task — the explicit
delete above is belt-and-suspenders, `db reset` is what actually guarantees clean state).

---

### Task 4: Regenerate types

**Files:**
- Modify: `packages/domain/src/generated.ts` (auto-generated, not hand-edited)

- [ ] **Step 1: Ensure the local Supabase stack is running**

Run: `supabase status`
Expected: shows `API URL`/`DB URL` as running. If stopped, run `supabase start` first.

- [ ] **Step 2: Regenerate types**

Run: `pnpm --filter @carebridge/db types:generate`
Expected: completes with no error; `git diff packages/domain/src/generated.ts` shows a new
`verification_override` table type (with `Row`/`Insert`/`Update` variants).

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/generated.ts
git commit -m "D2: regenerate types for verification_override"
```

---

### Task 5: `credential-expiry-cron` — remove duplicate NMC computation

**Files:**
- Modify: `supabase/functions/credential-expiry-cron/index.ts`

- [ ] **Step 1: Replace the whole file**

Current file (219 lines) has three steps: (1) flag expiring-soon/auto-expire lapsed
credentials, (2) its own hand-rolled recompute of `nmc_licensed` for every nurse, (3) notify
newly-suspended nurses by comparing step 2's own before/after. Step 2 is now redundant — step
1's `UPDATE credential SET status = 'expired'` already fires
`credential_recompute_verified_profile` (Task 1), which recomputes all four signals
correctly, not just NMC. Replace the full file content with:

```ts
// Edge Function: credential-expiry-cron
// Scheduled daily via pg_cron + pg_net (see supabase/migrations for the schedule) against
// this function's own URL, authenticated with a dedicated CRON_SECRET bearer token — not the
// Supabase service-role key, so a leaked schedule secret can't do more than trigger this one
// run. Fails closed (401/500) exactly like whatsapp-webhook's signature check, just simpler:
// this is an internal trigger, not a payload from an external party, so a static shared
// secret is the right level of protection (no HMAC-over-body needed).
//
// CLAUDE.md guardrail this implements: "Credential expiry is enforced by a cron Edge
// Function, not a UI reminder. NMC PIN/AIN expire every 12 months: flag within 30 days,
// auto-suspend scheduling eligibility on lapse."
//
// As of Increment D2 (see docs/superpowers/specs/2026-08-11-provider-verification-override-d2-design.md),
// this function no longer computes nmc_licensed itself. It only does the "flag within 30
// days" / "auto-expire lapsed credentials" work below — the UPDATE that auto-expires a
// credential fires internal.trg_recompute_verified_profile (a Postgres trigger, same
// transaction), which recomputes all four verified_profile signals from evidence, applying
// any active governed override, and is the single authoritative implementation shared with
// the ops-console app's own writes. This function used to duplicate that computation in JS;
// removed to avoid two independent implementations of the same eligibility logic drifting
// apart. To detect "newly suspended" for notification purposes, this function now snapshots
// verified_profile.nmc_licensed before its own updates and diffs against the value after —
// reading the trigger's output, not recomputing it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const EXPIRY_WARNING_DAYS = 30;
const CREDENTIAL_EXPIRING_SOON_TEMPLATE = "credential_expiring_soon";

async function sendWhatsappTemplate(to: string, templateName: string): Promise<string | null> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return null;
  }
  const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: "en" } },
    }),
  });
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as { messages?: { id: string }[] };
  return body.messages?.[0]?.id ?? null;
}

async function notify(
  supabase: ReturnType<typeof createClient>,
  recipients: { id: string; phone: string | null }[],
  templateName: string,
) {
  for (const recipient of recipients) {
    const { data: notification } = await supabase
      .from("notification")
      .insert({ user_id: recipient.id, channel: "whatsapp", template_id: templateName })
      .select("id")
      .single();

    if (!notification) continue;

    const messageId = recipient.phone ? await sendWhatsappTemplate(recipient.phone, templateName) : null;

    await supabase.from("whatsapp_message_log").insert({
      to_phone: recipient.phone ?? "unknown",
      template_name: templateName,
      status: messageId ? "sent" : "failed",
      wa_message_id: messageId,
    });

    if (messageId) {
      await supabase.from("notification").update({ sent_at: new Date().toISOString() }).eq("id", notification.id);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET not configured — refusing to run.");
    return new Response(JSON.stringify({ error: "not configured" }), { status: 500 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const warningCutoff = new Date(today.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // ── 0. Snapshot nurse verified_profile.nmc_licensed BEFORE this run's updates ─────────
  const { data: nurseRole } = await supabase.from("role").select("id").eq("slug", "nurse").single();
  const { data: nurseUsers } = nurseRole
    ? await supabase.from("user").select("id, phone").eq("role_id", nurseRole.id)
    : { data: [] };
  const nurseUserIds = (nurseUsers ?? []).map((u) => u.id);

  const { data: nurseProviders } =
    nurseUserIds.length > 0
      ? await supabase.from("provider").select("id, user_id").in("user_id", nurseUserIds)
      : { data: [] };

  const { data: beforeProfiles } =
    (nurseProviders ?? []).length > 0
      ? await supabase
          .from("verified_profile")
          .select("provider_id, nmc_licensed")
          .in(
            "provider_id",
            (nurseProviders ?? []).map((p) => p.id),
          )
      : { data: [] };
  const wasLicensedByProviderId = new Map((beforeProfiles ?? []).map((p) => [p.provider_id, p.nmc_licensed]));

  // ── 1. Flag expiring-soon / auto-expire lapsed credentials ────────────────────────────
  const { data: credentials } = await supabase
    .from("credential")
    .select("id, provider_id, status, expiry_date, credential_type:credential_type_id(slug, expiry_period_months)")
    .not("expiry_date", "is", null)
    .neq("status", "expired");

  let expiringSoon = 0;
  let autoExpired = 0;

  for (const credential of credentials ?? []) {
    const credentialType = credential.credential_type as unknown as {
      slug: string;
      expiry_period_months: number | null;
    } | null;
    if (!credentialType?.expiry_period_months) continue;

    const expiryDate = credential.expiry_date as string;

    if (expiryDate < todayIso) {
      await supabase.from("credential_verification_event").insert({
        credential_id: credential.id,
        outcome: "expired",
        notes: "Auto-expired by credential-expiry-cron (past expiry_date).",
      });
      // This UPDATE fires internal.trg_recompute_verified_profile (same transaction),
      // recomputing all four verified_profile signals for credential.provider_id.
      await supabase.from("credential").update({ status: "expired" }).eq("id", credential.id);
      autoExpired += 1;
    } else if (expiryDate <= warningCutoff) {
      expiringSoon += 1;
    }
  }

  // ── 2. Diff nurse verified_profile.nmc_licensed AFTER this run's updates ──────────────
  const { data: afterProfiles } =
    (nurseProviders ?? []).length > 0
      ? await supabase
          .from("verified_profile")
          .select("provider_id, nmc_licensed")
          .in(
            "provider_id",
            (nurseProviders ?? []).map((p) => p.id),
          )
      : { data: [] };

  const newlySuspended: { providerId: string; userId: string }[] = [];
  for (const profile of afterProfiles ?? []) {
    const wasLicensed = wasLicensedByProviderId.get(profile.provider_id) ?? false;
    if (wasLicensed && !profile.nmc_licensed) {
      const provider = (nurseProviders ?? []).find((p) => p.id === profile.provider_id);
      if (provider) newlySuspended.push({ providerId: provider.id, userId: provider.user_id });
    }
  }

  // ── 3. Notify newly-suspended providers + coordinators ────────────────────────────────
  if (newlySuspended.length > 0) {
    const { data: coordinatorRole } = await supabase.from("role").select("id").eq("slug", "coordinator").single();
    const { data: coordinators } = coordinatorRole
      ? await supabase.from("user").select("id, phone").eq("role_id", coordinatorRole.id)
      : { data: [] };

    const { data: suspendedUsers } = await supabase
      .from("user")
      .select("id, phone")
      .in(
        "id",
        newlySuspended.map((s) => s.userId),
      );

    await notify(
      supabase,
      [...(suspendedUsers ?? []), ...(coordinators ?? [])],
      CREDENTIAL_EXPIRING_SOON_TEMPLATE,
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      checked: (credentials ?? []).length,
      expiringSoon,
      autoExpired,
      suspended: newlySuspended.length,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/credential-expiry-cron/index.ts
git commit -m "D2: credential-expiry-cron reads recomputed eligibility instead of computing it"
```

---

### Task 6: Server actions — replace the raw toggle with governed override actions

**Files:**
- Modify: `apps/ops-console/app/providers/[id]/actions.ts`

- [ ] **Step 1: Delete `updateVerifiedProfile`**

Remove this function (the file's current last function, lines 168-186):

```ts
export async function updateVerifiedProfile(providerId: string, formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("verified_profile")
    .update({
      id_verified: formData.get("idVerified") === "on",
      nmc_licensed: formData.get("nmcLicensed") === "on",
      background_checked: formData.get("backgroundChecked") === "on",
      training_current: formData.get("trainingCurrent") === "on",
    })
    .eq("provider_id", providerId);

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?updated=profile`);
}
```

- [ ] **Step 2: Import `requireStaffUser`**

Change line 4 from:

```ts
import { createClient } from "@/lib/supabase/server";
```

to:

```ts
import { createClient } from "@/lib/supabase/server";
import { requireStaffUser } from "@/lib/auth";
```

- [ ] **Step 3: Add the override constants and two new actions**

Append at the end of the file (where `updateVerifiedProfile` used to be):

```ts

// Matches CRITICAL_RESOLVER_ROLE_SLUGS in apps/ops-console/app/exceptions/constants.ts —
// same bar for a credentialing-eligibility override as for resolving a critical escalation.
const OVERRIDE_APPROVER_ROLE_SLUGS = ["clinical_director", "admin"];

const OVERRIDE_SIGNALS = ["id_verified", "nmc_licensed", "background_checked", "training_current"];

export const OVERRIDE_SIGNAL_LABEL: Record<string, string> = {
  id_verified: "ID verification",
  nmc_licensed: "NMC PIN/AIN",
  background_checked: "Background check",
  training_current: "Training",
};

// Defense-in-depth, matching apps/ops-console/app/exceptions/actions.ts#resolveEscalation's
// own posture: verification_override's RLS (internal.is_credentialing_approver()) is the
// real gate — this check exists so a non-approver gets a specific, friendly error instead of
// an opaque RLS failure.
export async function createVerificationOverride(providerId: string, formData: FormData) {
  const staffUser = await requireStaffUser();

  if (!OVERRIDE_APPROVER_ROLE_SLUGS.includes(staffUser.roleSlug)) {
    redirect(
      `/providers/${providerId}?error=${encodeURIComponent("Only the Clinical Director or an admin can create a verification override.")}`,
    );
  }

  const signal = String(formData.get("signal") ?? "");
  const overrideValue = String(formData.get("overrideValue") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const effectiveUntil = String(formData.get("effectiveUntil") ?? "");

  if (!OVERRIDE_SIGNALS.includes(signal)) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("A valid signal is required.")}`);
  }

  if (overrideValue !== "true" && overrideValue !== "false") {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("A value is required.")}`);
  }

  if (!reason) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("A reason is required.")}`);
  }

  if (!effectiveUntil) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("An effective-until date is required.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("verification_override").insert({
    provider_id: providerId,
    signal,
    override_value: overrideValue === "true",
    reason,
    effective_until: effectiveUntil,
  });

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?added=override`);
}

export async function revokeVerificationOverride(providerId: string, overrideId: string, formData: FormData) {
  const staffUser = await requireStaffUser();

  if (!OVERRIDE_APPROVER_ROLE_SLUGS.includes(staffUser.roleSlug)) {
    redirect(
      `/providers/${providerId}?error=${encodeURIComponent("Only the Clinical Director or an admin can revoke a verification override.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("verification_override")
    .update({ revoked_at: new Date().toISOString(), revoked_by: staffUser.id })
    .eq("id", overrideId);

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?updated=override`);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/providers/[id]/actions.ts
git commit -m "D2: replace raw verified_profile toggle with governed override actions"
```

---

### Task 7: Provider detail page — read-only badges + Overrides section

**Files:**
- Modify: `apps/ops-console/app/providers/[id]/page.tsx`

- [ ] **Step 1: Update imports**

Change lines 1-15 from:

```tsx
import { notFound } from "next/navigation";
import { Button, DataTable, EntitySummaryCard } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import {
  addBackgroundCheck,
  addCredential,
  addIdentityVerification,
  addTrainingRecord,
  logCredentialVerification,
  updateEmploymentStatus,
  updateVerifiedProfile,
} from "./actions";
```

to:

```tsx
import { notFound } from "next/navigation";
import { Button, ConfirmSubmitButton, DataTable, EntitySummaryCard, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { getProviderVerificationBadges, type VerificationState } from "@/lib/provider-verification-status";
import {
  addBackgroundCheck,
  addCredential,
  addIdentityVerification,
  addTrainingRecord,
  createVerificationOverride,
  logCredentialVerification,
  OVERRIDE_SIGNAL_LABEL,
  revokeVerificationOverride,
  updateEmploymentStatus,
} from "./actions";
```

- [ ] **Step 2: Add the badge-variant map and a local render helper**

After the `TrainingRecordRow` interface (after line 48), add:

```tsx

interface VerificationOverrideRow {
  id: string;
  signal: string;
  override_value: boolean;
  reason: string;
  effective_from: string;
  effective_until: string;
  revoked_at: string | null;
}

// Duplicated from actions.ts's own copy (used there for server-side validation, here for the
// <select> options) — matches this file's existing VERIFICATION_STATUSES precedent, already
// independently declared in both actions.ts and page.tsx.
const OVERRIDE_SIGNALS = ["id_verified", "nmc_licensed", "background_checked", "training_current"];

// Matches D1's own VERIFICATION_BADGE map in apps/ops-console/app/providers/page.tsx —
// duplicated here rather than shared, same small-array-duplication precedent already
// established between this file and its own actions.ts (VERIFICATION_STATUSES).
const VERIFICATION_BADGE: Record<
  VerificationState,
  { variant: "success" | "warning" | "critical" | "neutral"; label: string }
> = {
  verified: { variant: "success", label: "Verified" },
  expiring: { variant: "warning", label: "Expiring" },
  missing: { variant: "critical", label: "Missing" },
  not_applicable: { variant: "neutral", label: "N/A" },
};

function verificationBadge(signalLabel: string, state: VerificationState) {
  const { variant, label } = VERIFICATION_BADGE[state];
  return <StatusBadge variant={variant} label={`${signalLabel} — ${label}`} />;
}
```

- [ ] **Step 3: Widen the `credential_type`, `credential`, `identity_verification`,
      `background_check`, and `training_record` selects to include `slug`/`created_at`**

Change (lines 84-105, within the `Promise.all`):

```ts
    supabase.from("verified_profile").select("*").eq("provider_id", provider.id).maybeSingle(),
    supabase
      .from("credential")
      .select("id, credential_type_id, issuing_authority, status, expiry_date")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase.from("credential_type").select("id, label").order("label"),
    supabase
      .from("identity_verification")
      .select("id, vendor, status, verified_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("background_check")
      .select("id, status, document_ref, expires_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("training_record")
      .select("id, title, cpd_points, completed_at")
      .eq("provider_id", provider.id)
      .order("completed_at", { ascending: false }),
  ]);
```

to:

```ts
    supabase.from("verified_profile").select("*").eq("provider_id", provider.id).maybeSingle(),
    supabase
      .from("credential")
      .select("id, credential_type_id, issuing_authority, status, expiry_date, created_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase.from("credential_type").select("id, label, slug").order("label"),
    supabase
      .from("identity_verification")
      .select("id, vendor, status, verified_at, created_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("background_check")
      .select("id, status, document_ref, expires_at, created_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("training_record")
      .select("id, title, cpd_points, completed_at, created_at")
      .eq("provider_id", provider.id)
      .order("completed_at", { ascending: false }),
  ]);
```

- [ ] **Step 4: Fetch the provider's role and `verification_override` rows, compute the badges**

This page needs the *provider's* role (nurse or not — `getProviderVerificationBadges`'s
`isNurse` flag), not the viewing staff user's role, so the `user` query needs `role_id` and a
new `role` query is needed alongside it. Change the `Promise.all` block from Step 3 (the same
block, one more edit) — the `user` query is its first element:

```ts
    supabase.from("user").select("full_name, email, phone").eq("id", provider.user_id).maybeSingle(),
```

to:

```ts
    supabase.from("user").select("full_name, email, phone, role_id").eq("id", provider.user_id).maybeSingle(),
```

and add one more query as the array's new final element:

```ts
    supabase.from("role").select("id, slug"),
```

The destructuring on the left of this same `Promise.all` (lines 73-81) gains a matching
final entry. Change:

```ts
  const [
    { data: user },
    { data: verifiedProfile },
    { data: credentials },
    { data: credentialTypes },
    { data: identityVerifications },
    { data: backgroundChecks },
    { data: trainingRecords },
  ] = await Promise.all([
```

to:

```ts
  const [
    { data: user },
    { data: verifiedProfile },
    { data: credentials },
    { data: credentialTypes },
    { data: identityVerifications },
    { data: backgroundChecks },
    { data: trainingRecords },
    { data: roles },
  ] = await Promise.all([
```

Then, after the `credentialTypeLabelById` line (after line 107), add:

```ts

  const roleSlugById = new Map((roles ?? []).map((role) => [role.id, role.slug]));
  const isNurse = user ? roleSlugById.get(user.role_id) === "nurse" : false;

  const credentialTypeSlugById = new Map((credentialTypes ?? []).map((type) => [type.id, type.slug]));
  const nmcCredentials = (credentials ?? []).filter((c) => credentialTypeSlugById.get(c.credential_type_id) === "nmc_pin_ain");

  const todayIso = new Date().toISOString().slice(0, 10);
  const warningCutoffIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const verificationBadges = getProviderVerificationBadges({
    isNurse,
    identityVerifications: (identityVerifications ?? []).map((row) => ({ status: row.status, createdAt: row.created_at })),
    nmcCredentials: nmcCredentials.map((row) => ({ status: row.status, expiryDate: row.expiry_date, createdAt: row.created_at })),
    backgroundChecks: (backgroundChecks ?? []).map((row) => ({ status: row.status, expiresAt: row.expires_at, createdAt: row.created_at })),
    trainingRecords: (trainingRecords ?? []).map((row) => ({ createdAt: row.created_at })),
    todayIso,
    warningCutoffIso,
  });

  const { data: overrides } = await supabase
    .from("verification_override")
    .select("id, signal, override_value, reason, effective_from, effective_until, revoked_at")
    .eq("provider_id", provider.id)
    .order("created_at", { ascending: false });

  const isApprover = staffUser.roleSlug === "clinical_director" || staffUser.roleSlug === "admin";

  const boundCreateOverride = createVerificationOverride.bind(null, provider.id);
```

(`getProviderVerificationBadges` destructures `nmcCredentials` — the parameter name matches
D1's `apps/ops-console/lib/provider-verification-status.ts` exactly; no changes needed to
that file.)

- [ ] **Step 5: Delete the old checkbox form, insert the read-only badges + Overrides section**

Delete the entire `"Verified profile"` section (lines 166-195):

```tsx
      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Verified profile</h2>
        <form action={boundUpdateProfile} className="flex flex-col gap-3 rounded-md border border-border p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="idVerified" defaultChecked={verifiedProfile?.id_verified ?? false} />
            ID verified
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="nmcLicensed" defaultChecked={verifiedProfile?.nmc_licensed ?? false} />
            NMC licensed (scheduling eligibility — recomputed automatically each night once an NMC
            PIN/AIN credential is logged; this toggle is a manual stopgap between now and the next
            automatic check)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="backgroundChecked"
              defaultChecked={verifiedProfile?.background_checked ?? false}
            />
            Background checked
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="trainingCurrent" defaultChecked={verifiedProfile?.training_current ?? false} />
            Training current
          </label>
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      </section>
```

Replace with:

```tsx
      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Verified profile</h2>
        <p className="text-sm text-muted-foreground">
          Computed automatically from the records below — not editable here. To temporarily
          correct a value, use an override below.
        </p>
        <div className="flex flex-wrap gap-2 rounded-md border border-border p-4">
          {verificationBadge("ID", verificationBadges.id)}
          {verificationBadge("NMC", verificationBadges.nmc)}
          {verificationBadge("Background", verificationBadges.background)}
          {verificationBadge("Training", verificationBadges.training)}
        </div>
      </section>

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Verification overrides</h2>
        <DataTable<VerificationOverrideRow>
          rows={overrides ?? []}
          rowKey={(row) => row.id}
          emptyMessage="No overrides on record."
          columns={[
            { key: "signal", header: "Signal", render: (row) => OVERRIDE_SIGNAL_LABEL[row.signal] ?? row.signal },
            { key: "value", header: "Value", render: (row) => (row.override_value ? "True" : "False") },
            { key: "reason", header: "Reason", render: (row) => row.reason },
            {
              key: "window",
              header: "Effective",
              render: (row) => `${formatDate(row.effective_from)} – ${formatDate(row.effective_until)}`,
            },
            {
              key: "state",
              header: "Status",
              render: (row) =>
                row.revoked_at ? (
                  <StatusBadge variant="neutral" label="Revoked" />
                ) : new Date(row.effective_until) < new Date() ? (
                  <StatusBadge variant="neutral" label="Expired" />
                ) : (
                  <StatusBadge variant="warning" label="Active" />
                ),
            },
            {
              key: "actions",
              header: "",
              render: (row) =>
                !row.revoked_at && new Date(row.effective_until) >= new Date() && isApprover ? (
                  <form action={revokeVerificationOverride.bind(null, provider.id, row.id)}>
                    <ConfirmSubmitButton
                      size="sm"
                      variant="outline"
                      confirmTitle="Revoke override"
                      confirmDescription={
                        <>
                          Revoke this override on <strong>{OVERRIDE_SIGNAL_LABEL[row.signal]}</strong>? The
                          computed value will apply again immediately.
                        </>
                      }
                      confirmLabel="Revoke"
                    >
                      Revoke
                    </ConfirmSubmitButton>
                  </form>
                ) : null,
            },
          ]}
        />

        {isApprover ? (
          <form action={boundCreateOverride} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4">
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Signal
              <select name="signal" required defaultValue="" className="rounded-md border border-border px-3 py-2">
                <option value="" disabled>
                  Select
                </option>
                {OVERRIDE_SIGNALS.map((signal) => (
                  <option key={signal} value={signal}>
                    {OVERRIDE_SIGNAL_LABEL[signal]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Value
              <select name="overrideValue" required defaultValue="" className="rounded-md border border-border px-3 py-2">
                <option value="" disabled>
                  Select
                </option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Reason
              <input name="reason" required className="rounded-md border border-border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Effective until
              <input type="date" name="effectiveUntil" required className="rounded-md border border-border px-3 py-2" />
            </label>
            <ConfirmSubmitButton
              size="sm"
              confirmTitle="Create override"
              confirmDescription="This overrides the computed verification status for this provider until the effective-until date. Confirm?"
              confirmLabel="Create override"
            >
              Create override
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </section>
```

- [ ] **Step 6: Remove the now-unused `boundUpdateProfile` binding**

Delete this line (originally line 115):

```ts
  const boundUpdateProfile = updateVerifiedProfile.bind(null, provider.id);
```

- [ ] **Step 7: Commit**

```bash
git add apps/ops-console/app/providers/[id]/page.tsx
git commit -m "D2: read-only verification badges + governed override UI on provider detail"
```

---

### Task 8: Typecheck and lint

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 3: Fix and re-run if either fails**

Fix any reported issue in the file it names, re-run both until clean. Do not proceed to
Task 9 until both pass.

---

### Amendment (found during Task 9's own browser verification)

`actions.ts` has `"use server";` at the top — Next.js requires every export from a
`"use server"` file to be an async function; a plain `export const OVERRIDE_SIGNAL_LABEL:
Record<string, string> = {...}` (added in Task 6) makes the entire route 500 on every
request, for every user, the instant the module is evaluated. Neither typecheck nor lint
catches this — it's a Next.js RSC-loader rule, not a TypeScript/ESLint one — so it went
undetected through Tasks 6-8 and was only caught here, the first point anything actually
loaded the page in a browser. Fixed by moving `OVERRIDE_SIGNAL_LABEL` (and the derived
`OVERRIDE_SIGNALS`) into a new plain module, `apps/ops-console/app/providers/[id]/constants.ts`
— matching this codebase's own established precedent for the identical problem
(`apps/ops-console/app/exceptions/constants.ts` sits next to `exceptions/actions.ts` for
exactly this reason). `actions.ts` keeps only its async server actions; both `actions.ts`
(for validation) and `page.tsx` (for display) import the signal data from `constants.ts`
instead.

### Task 9: Verify end-to-end in the browser against real local Postgres

**Files:** none (verification only)

- [ ] **Step 1: Reset to clean seed state and start the stack**

Run: `supabase db reset`, confirm running via `supabase status`, start the dev server
(`pnpm --filter ops-console dev`, background). Set local dev passwords on both
`coordinator1@carebridge.dev` and `director@carebridge.dev` if not already set this session
(same pattern as `docs/superpowers/plans/2026-08-11-scheduling-summary-c2.md` Task 4 Step 1 —
get `<SERVICE_ROLE_KEY>` from `supabase status`):

```bash
curl -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/a0000000-0000-0000-0000-000000000001" \
  -H "apikey: <SERVICE_ROLE_KEY>" -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" -d '{"password":"carebridge-dev-2026"}'
curl -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/a0000000-0000-0000-0000-000000000003" \
  -H "apikey: <SERVICE_ROLE_KEY>" -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" -d '{"password":"carebridge-dev-2026"}'
```

- [ ] **Step 2: Confirm read-only display as coordinator**

Log in as `coordinator1@carebridge.dev`. Go to `/providers/c0000000-0000-0000-0000-000000000003`
(Akosua Darko). Confirm the "Verified profile" section shows four read-only badges (no
checkboxes anywhere) reading "ID — Verified", "NMC — Missing", "Background — Verified",
"Training — Verified" — matching D1's own ground-truth grid for this provider. Confirm the
"Verification overrides" section shows an empty table and **no** create-override form (not a
`clinical_director`/`admin`).

- [ ] **Step 3: Confirm the override form appears for an approver and creates a real override**

Log out, log in as `director@carebridge.dev`. Return to the same provider page. Confirm the
create-override form is now visible. Fill: Signal = "NMC PIN/AIN", Value = "True", Reason =
"Phone-verified renewal pending paperwork", Effective until = a date 30 days out. Submit,
confirm the dialog, confirm. Confirm the page redirects back with an `added=override`
success message, the new row appears in the overrides table with an "Active" badge, and the
"Verified profile" section's NMC badge is **unchanged** — still "NMC — Missing" (evidence-derived —
this badge doesn't read the override at all, it's still computed purely from evidence; the
override affects `verified_profile`, not D1's display module, so seeing the badge stay
"Missing" while the override is genuinely active is the CORRECT, expected outcome, not a
bug — it's the exact dual-reading the design doc calls out).

- [ ] **Step 4: Confirm the override reached `verified_profile` and `/visits/new`**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select nmc_licensed from verified_profile where provider_id = 'c0000000-0000-0000-0000-000000000003';"
```

Expected: `true`. Go to `/visits/new`, select any active client (reactivate one via
`/clients/[id]` first if none are active, per prior increments' known default), open the
provider dropdown. Confirm Akosua Darko's blocked-reason list no longer includes "NMC
PIN/AIN not licensed" (still shows "not yet rostered to any zone", since she has no roster
row — the override doesn't touch that).

- [ ] **Step 5: Revoke the override and confirm it reverts everywhere**

Back on the provider page, click "Revoke" on the new override row, confirm. Confirm the row's
badge changes to "Revoked" and the create-override form is still available (still logged in
as an approver). Re-run the same `psql` query from Step 4 — expect `false` again. Re-check
`/visits/new` — expect "NMC PIN/AIN not licensed" back in Akosua Darko's blocked reasons.

- [ ] **Step 6: Confirm a direct write attempt is genuinely rejected, not just hidden**

With devtools open (or `curl`), attempt a direct Supabase REST `PATCH` on `verified_profile`
as the logged-in coordinator (using the session's own access token from the browser's
Application/Storage tab, or via the JS console: `fetch` against
`/rest/v1/verified_profile?provider_id=eq.c0000000-0000-0000-0000-000000000003` with the
Supabase anon key + the session's bearer token, body `{"nmc_licensed": true}`). Confirm the
response is either a 0-row success (RLS silently filtered) or an explicit RLS rejection — not
a successful write. Re-query via `psql` to confirm the value didn't change.

- [ ] **Step 7: Clean up**

`supabase db reset` to wipe test overrides and any reactivated-client state. Stop the dev
server. `supabase stop`.

No code changes in this task. If any step's actual result doesn't match expected, do not
patch ad hoc — report exactly what happened so the relevant task above can be fixed.

---

### Task 10: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off Increment D2**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist):

```
  - [ ] Increment D2 (**supervisor-tier — touches the credentialing/eligibility boundary CLAUDE.md gates**): make `verified_profile`'s cron-computed booleans read-only in the UI; add a separate governed override table/flow (reason, approver, effective period, audit) distinct from computed eligibility — closes the review's P0 "manual toggle beside computed status" finding, which is real (confirmed: today's provider-detail page lets staff hand-toggle the same 4 booleans the cron also recomputes, Phase 1 credentialing epic Story 2/3)
```

Replace with a checked line summarizing what actually got built, in this file's established
style. Record at minimum: the real scope gap found (only `nmc_licensed` was actually
cron-computed; the other 3 were pure manual flags) and the decision to extend computation to
all 4; the write-through recompute architecture (security-definer function + trigger on 5
tables) chosen over a read-time join, and why; `verified_profile`'s write policy being
dropped entirely (not narrowed) as what actually makes it read-only; `verification_override`'s
RLS restricting to `clinical_director`/`admin` with a mandatory `effective_until`;
`credential-expiry-cron`'s duplicate NMC logic being retired in favor of the shared recompute
path; and the real verification performed (role-impersonation SQL proving both the write
lockout and the approver-only override path, a live override observed reaching
`verified_profile` and `/visits/new` and reverting on revoke).

- [ ] **Step 2: Add a changelog entry**

Add a new dated bullet under the `### Changelog` section, matching the density and honesty of
the B0-D1 changelog entries already in this file.

- [ ] **Step 3: Update the "Last updated" summary line**

Update the top summary line to reflect D2 is done and name whichever increment (D3) is next
per the epic's own ordering (confirm against the roadmap's own checklist rather than trusting
this plan's memory of it).

- [ ] **Step 4: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment D2, next up Increment D3"
```

(Confirm the actual next-increment name/number against the roadmap's own checklist before
writing this commit message.)
