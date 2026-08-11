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

-- No delete policy — RLS default-denies delete for every role. Overrides are corrected by
-- revoking (an update setting revoked_at/revoked_by), never erased, matching this codebase's
-- append-only-audit-trail spirit even though this isn't audit_log itself.

create trigger verification_override_audit after insert or update or delete on verification_override for each row execute function internal.audit_row_change();

grant select, insert, update, delete on verification_override to authenticated;
grant select, insert, update, delete on verification_override to service_role;

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

  select exists (
    select 1 from identity_verification
    where provider_id = target_provider_id and status = 'verified'
  ) into v_id_verified;

  -- Non-nurses default to true here (never gates anything — getBlockedReasons in
  -- provider-eligibility.ts only ever checks nmcLicensed when isNurse is true — this matches
  -- the pre-D2 cron's own behavior of never touching caregivers' nmc_licensed). This is NOT
  -- D1's UI "not_applicable" display state — the stored boolean has no third state and
  -- doesn't need one.
  select coalesce(v_is_nurse, false) = false or exists (
    select 1
    from credential c
    join credential_type ct on ct.id = c.credential_type_id
    where c.provider_id = target_provider_id
      and ct.slug = 'nmc_pin_ain'
      and c.status = 'verified'
      and (c.expiry_date is null or c.expiry_date >= current_date)
  ) into v_nmc_licensed;

  select exists (
    select 1 from background_check
    where provider_id = target_provider_id
      and status = 'verified'
      and (expires_at is null or expires_at >= now())
  ) into v_background_checked;

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
