-- Domain 4 — Scheduling & Visit Ops: zone, roster, visit, visit_checkin, observation, task.
-- Coordinator-console epic Story 2 (carebridge-roadmap.md, Phase 1) — blocks Stories 4-6
-- (visit scheduling UI, manual visit logging UI, exception queue).
--
-- Design note (client.zone_id backfill): Domain 2 left client.zone_id as a plain
-- `uuid not null` because zone didn't exist yet (same deferred-FK pattern as Domain 1/2).
-- This migration adds the FK constraint now that zone exists.
--
-- Design note (structural vs. clinical visibility, extending the Domain 2 precedent):
-- visit (schedule/status) and visit_checkin (arrival/departure/zone) are structural —
-- "who's coming, when, did they show up" — visible to a linked family sponsor without a
-- consent_grant, same tier as client/emergency_contact. observation (a nurse's clinical
-- observation about the client) and task (a checklist item that may reflect care-plan
-- content, e.g. "administer medication") are treated as clinical detail, gated behind
-- has_consent(client_id, 'clinical_detail') for sponsors — same tier as care_plan. This is a
-- judgment call for task (it could plausibly be logistics-only); defaulting to the more
-- restrictive tier until a real story says otherwise costs usability, not safety.
-- Two new helper functions capture this once instead of repeating the visit->client/provider
-- join in four separate RLS policies: internal.can_view_visit_structural and
-- internal.can_view_visit_clinical. Providers see their own visits' structural AND clinical
-- data with no consent check — consent_grant gates family-sponsor access to clinical
-- content, it has nothing to do with a provider's own operational visibility.
--
-- Design note (visit_checkin never stores a raw location trail): CLAUDE.md's
-- live_visit_tracking guardrail ("foreground-only... raw location trail purged on visit
-- completion, retaining only arrival/departure timestamps and zone... enforce in
-- schema/retention job, not just policy") is about a *continuous* background trail.
-- visit_checkin only ever records discrete named events (en_route/arrived/departed) with a
-- zone-level reference, never a coordinate — there is no raw trail column to purge, by
-- construction. A continuous, foreground-only, purge-on-completion location stream (the
-- literal live_visit_tracking table) is Domain 5 (Trust, Rating & Feedback) and belongs to
-- the Phase 2 "Know Your Caregiver" epic — LOCKED, not built here.
--
-- Design note (manual-first, staff-only writes): matches the Domain 3 precedent and the
-- Phase 1 story text directly ("coordinator logs a visit outcome... on behalf of a provider
-- who reports in by phone, so service continues even when the field app doesn't exist yet").
-- All writes here are staff-only; providers get read-only access to their own visits. Once
-- the field app exists (Phase 2, LOCKED), provider-initiated writes to visit_checkin/task
-- are a new story, not a retrofit of this migration.
--
-- Design note (escalation flag deferred): the Phase 1 story text mentions logging an
-- "escalation flag" alongside a visit outcome. Escalation is modeled as its own first-class
-- entity (docs/domain-model.md: "Escalation is first-class, not a notification subtype") in
-- Domain 7, which is Story 3 (not yet built) — not a boolean column bolted onto observation
-- here. The exception-queue story (Story 6) depends on both this migration and Story 3.

-- ── zone ─────────────────────────────────────────────────────────────────────────────

create table zone (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references "user"(id) -- nullable: seed rows have no authenticated actor
);

create trigger zone_set_updated_at
  before update on zone
  for each row execute function public.set_updated_at();

-- Backfill the FK constraint deferred from the Domain 2 migration, now that zone exists.
alter table client
  add constraint client_zone_id_fkey foreign key (zone_id) references zone(id);

-- ── roster ───────────────────────────────────────────────────────────────────────────
-- Weekly provider-to-zone assignment. One row per provider per week.

create table roster (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider(id),
  zone_id uuid not null references zone(id),
  week_starting date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create unique index roster_provider_week_unique on roster (provider_id, week_starting);
create index roster_zone_id_idx on roster (zone_id);

create trigger roster_set_updated_at
  before update on roster
  for each row execute function public.set_updated_at();

-- ── visit ────────────────────────────────────────────────────────────────────────────

create table visit (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  provider_id uuid not null references provider(id),
  care_plan_id uuid not null references care_plan(id),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'en_route', 'in_progress', 'completed', 'missed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id),
  check (scheduled_end > scheduled_start)
);

create index visit_client_id_idx on visit (client_id);
create index visit_provider_id_idx on visit (provider_id);
create index visit_scheduled_start_idx on visit (scheduled_start);
create index visit_status_idx on visit (status);

create trigger visit_set_updated_at
  before update on visit
  for each row execute function public.set_updated_at();

-- ── visit_checkin ────────────────────────────────────────────────────────────────────
-- zone_id, not raw coordinates — see design note above.

create table visit_checkin (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  event text not null check (event in ('en_route', 'arrived', 'departed')),
  occurred_at timestamptz not null default now(),
  zone_id uuid references zone(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index visit_checkin_visit_id_idx on visit_checkin (visit_id);

create trigger visit_checkin_set_updated_at
  before update on visit_checkin
  for each row execute function public.set_updated_at();

-- ── observation ──────────────────────────────────────────────────────────────────────

create table observation (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  type text not null,
  value text not null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index observation_visit_id_idx on observation (visit_id);

create trigger observation_set_updated_at
  before update on observation
  for each row execute function public.set_updated_at();

-- ── task ─────────────────────────────────────────────────────────────────────────────

create table task (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  description text not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index task_visit_id_idx on task (visit_id);

create trigger task_set_updated_at
  before update on task
  for each row execute function public.set_updated_at();

-- ── RLS helper functions ────────────────────────────────────────────────────────────
-- Created directly in `internal` (not `public`) — creating a SECURITY DEFINER function in
-- `public` re-exposes it as a PostgREST RPC endpoint, exactly the finding fixed in
-- 20260809180000_security_hardening.sql. `internal` already has USAGE granted to
-- authenticated/anon from that migration; PostgreSQL's default EXECUTE-to-PUBLIC grant on
-- newly created functions covers the rest.

create or replace function internal.can_view_visit_structural(target_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from visit v
    where v.id = target_visit_id
      and (internal.is_own_provider(v.provider_id) or internal.is_linked_sponsor(v.client_id))
  )
$$;

create or replace function internal.can_view_visit_clinical(target_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from visit v
    where v.id = target_visit_id
      and (
        internal.is_own_provider(v.provider_id)
        or (internal.is_linked_sponsor(v.client_id) and internal.has_consent(v.client_id, 'clinical_detail'))
      )
  )
$$;

-- ── RLS: zone ────────────────────────────────────────────────────────────────────────
-- Reference-table pattern, matching credential_type: readable by anyone authenticated (zone
-- names carry no client-specific sensitivity), staff-only write.

alter table zone enable row level security;

create policy zone_select_authenticated on zone
  for select
  to authenticated
  using (true);

create policy zone_write_staff on zone
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: roster ──────────────────────────────────────────────────────────────────────

alter table roster enable row level security;

create policy roster_select_self_or_staff on roster
  for select
  to authenticated
  using (internal.is_staff() or internal.is_own_provider(provider_id));

create policy roster_write_staff on roster
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: visit ───────────────────────────────────────────────────────────────────────

alter table visit enable row level security;

create policy visit_select_structural on visit
  for select
  to authenticated
  using (internal.is_staff() or internal.is_own_provider(provider_id) or internal.is_linked_sponsor(client_id));

create policy visit_write_staff on visit
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: visit_checkin ───────────────────────────────────────────────────────────────

alter table visit_checkin enable row level security;

create policy visit_checkin_select_structural on visit_checkin
  for select
  to authenticated
  using (internal.is_staff() or internal.can_view_visit_structural(visit_id));

create policy visit_checkin_write_staff on visit_checkin
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: observation ─────────────────────────────────────────────────────────────────

alter table observation enable row level security;

create policy observation_select_clinical on observation
  for select
  to authenticated
  using (internal.is_staff() or internal.can_view_visit_clinical(visit_id));

create policy observation_write_staff on observation
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: task ────────────────────────────────────────────────────────────────────────

alter table task enable row level security;

create policy task_select_clinical on task
  for select
  to authenticated
  using (internal.is_staff() or internal.can_view_visit_clinical(visit_id));

create policy task_write_staff on task
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── Audit triggers ───────────────────────────────────────────────────────────────────
-- Attached from creation (post-Domain-9 pattern) using internal.audit_row_change(), the
-- post-hardening qualified name.

create trigger zone_audit after insert or update or delete on zone for each row execute function internal.audit_row_change();
create trigger roster_audit after insert or update or delete on roster for each row execute function internal.audit_row_change();
create trigger visit_audit after insert or update or delete on visit for each row execute function internal.audit_row_change();
create trigger visit_checkin_audit after insert or update or delete on visit_checkin for each row execute function internal.audit_row_change();
create trigger observation_audit after insert or update or delete on observation for each row execute function internal.audit_row_change();
create trigger task_audit after insert or update or delete on task for each row execute function internal.audit_row_change();

-- ── Grants ───────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on zone to authenticated;
grant select, insert, update, delete on roster to authenticated;
grant select, insert, update, delete on visit to authenticated;
grant select, insert, update, delete on visit_checkin to authenticated;
grant select, insert, update, delete on observation to authenticated;
grant select, insert, update, delete on task to authenticated;
