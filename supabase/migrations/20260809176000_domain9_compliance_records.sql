-- Domain 9 (remainder) — Compliance & Audit: consent_record, dpc_registration,
-- incident_report, data_retention_policy. `audit_log` + the retrofit trigger were built
-- separately in 20260809173000_domain9_audit_log.sql; this migration completes Domain 1's
-- exit criterion "core schema live with RLS on every table ... Compliance & Audit."
--
-- Design note (consent_record vs. consent_grant — do not confuse the two): consent_grant
-- (Domain 1) is the internal RLS access-control mechanism — it decides whether a family
-- sponsor can read a specific piece of data. consent_record here is the regulatory artifact —
-- evidence that a client (or their decision-maker) signed a Ghana Data Protection Act,
-- 2012 (Act 843) data-processing consent form. One is an authorization check, the other is a
-- compliance document trail. They are not derived from each other.
--
-- Design note (incident_report routing is NOT built here): CLAUDE.md requires safeguarding
-- complaints to be "routed to the clinical director, never averaged into a rating." This
-- migration only stores the record; actually notifying/routing to a clinical director is
-- escalation/alert-routing logic (CLAUDE.md: supervisor-tier, "a missed escalation is a
-- safety incident") that belongs to a future escalation-engine story
-- (supabase/functions/escalation-engine per the repo map), not this schema migration.
--
-- Design note (data_retention_policy has no seed rows yet): the concrete retention rules this
-- guardrail requires (e.g. purging live_visit_tracking's raw location trail on visit
-- completion) reference Domain 4 tables that don't exist yet. Seeding rows for
-- domains that don't exist would be premature; add them alongside the domain that needs them.
--
-- Design note (audit triggers included from the start): unlike Domains 1-3, which needed a
-- separate retrofit migration, every table below gets its audit_row_change() trigger in the
-- same migration that creates it — the standing rule going forward, not a one-time backlog
-- item.

-- ── consent_record ───────────────────────────────────────────────────────────────────

create table consent_record (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  document_ref text not null, -- Supabase Storage object path to the signed consent document
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index consent_record_client_id_idx on consent_record (client_id);

create trigger consent_record_set_updated_at
  before update on consent_record
  for each row execute function public.set_updated_at();

create trigger consent_record_audit after insert or update or delete on consent_record for each row execute function public.audit_row_change();

alter table consent_record enable row level security;

create policy consent_record_select_linked_or_staff on consent_record
  for select
  to authenticated
  using (public.is_staff() or public.is_linked_sponsor(client_id));

create policy consent_record_write_staff on consent_record
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update, delete on consent_record to authenticated;

-- ── dpc_registration ─────────────────────────────────────────────────────────────────
-- CareBridge's own Data Protection Commission controller registration status — not
-- client-scoped, internal compliance data only. See docs/compliance/ for the human-readable
-- registration record this table tracks.

create table dpc_registration (
  id uuid primary key default gen_random_uuid(),
  registration_number text not null,
  status text not null check (status in ('active', 'pending', 'lapsed')),
  renewal_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create trigger dpc_registration_set_updated_at
  before update on dpc_registration
  for each row execute function public.set_updated_at();

create trigger dpc_registration_audit after insert or update or delete on dpc_registration for each row execute function public.audit_row_change();

alter table dpc_registration enable row level security;

create policy dpc_registration_all_staff on dpc_registration
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update, delete on dpc_registration to authenticated;

-- ── incident_report ──────────────────────────────────────────────────────────────────
-- Safeguarding/incident records. Staff-visible only — never exposed to family sponsors, and
-- (per CLAUDE.md) never averaged into visit_rating/service_rating.

create table incident_report (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references client(id),
  provider_id uuid references provider(id),
  description text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  reported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index incident_report_client_id_idx on incident_report (client_id);
create index incident_report_provider_id_idx on incident_report (provider_id);

create trigger incident_report_set_updated_at
  before update on incident_report
  for each row execute function public.set_updated_at();

create trigger incident_report_audit after insert or update or delete on incident_report for each row execute function public.audit_row_change();

alter table incident_report enable row level security;

create policy incident_report_all_staff on incident_report
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update, delete on incident_report to authenticated;

-- ── data_retention_policy ────────────────────────────────────────────────────────────
-- Reference/config table: how long each entity type's data should be kept. entity_type is
-- free text by convention (expected to match a table name) rather than FK/enum-constrained —
-- constraining it would couple this table to every future migration that adds a table.

create table data_retention_policy (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null unique,
  retention_days integer not null check (retention_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create trigger data_retention_policy_set_updated_at
  before update on data_retention_policy
  for each row execute function public.set_updated_at();

create trigger data_retention_policy_audit after insert or update or delete on data_retention_policy for each row execute function public.audit_row_change();

alter table data_retention_policy enable row level security;

create policy data_retention_policy_all_staff on data_retention_policy
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update, delete on data_retention_policy to authenticated;
