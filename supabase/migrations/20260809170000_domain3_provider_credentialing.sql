-- Domain 3 — Provider & Credentialing: provider, credential, credential_verification_event,
-- identity_verification, background_check, training_record, verified_profile, plus the
-- credential_type reference table the polymorphic credential subsystem is built on (ADR-0001,
-- CLAUDE.md: "Credentials are one polymorphic subsystem ... never create ad-hoc tables per
-- document type"). Seeding credential_type here also satisfies the Phase 0 exit criterion
-- ("credential_type registry seeded: Ghana Card, NMC PIN/AIN, police report, reference check,
-- CPD record").
--
-- Design note (manual-first writes): roadmap Phase 1 epic is "Provider onboarding &
-- credentialing, manual-first (credential upload/logging...)" — a coordinator/clinical
-- director logs and verifies documents on a provider's behalf. All writes to every table in
-- this migration are staff-only; a provider can SELECT (read) their own credentialing data
-- but cannot self-attest a verification status. Self-service credential upload is a possible
-- later story once manual-first is validated, not built now.
--
-- Design note (verified_profile is a manual/derived rollup, not auto-computed): the actual
-- computation of id_verified/nmc_licensed/background_checked/training_current from the
-- underlying credential/identity_verification/background_check/training_record rows, plus
-- 30-day expiry flagging and auto-suspension on lapse, is CLAUDE.md's "cron Edge Function"
-- guardrail (supabase/functions/credential-expiry-cron) — not built in this migration. Until
-- that lands, these are plain staff-writable booleans.
--
-- Design note (no family-sponsor visibility yet): the "Know Your Caregiver" trust card that
-- exposes provider trust info to sponsoring families is Phase 2 (LOCKED). This migration
-- grants read access to staff and the provider themselves only.
--
-- Design note (simplification vs. packages/domain/src/credentialing.ts placeholder): that
-- file has both `provider.verifiedProfileId` and `verified_profile.providerId` pointing at
-- each other — two sources of truth for one 1:1 relationship. This migration keeps only
-- verified_profile.provider_id (unique, not null); provider has no verified_profile_id
-- column. Also omits a redundant `provider.role` column — a provider's clinical role (nurse
-- vs. caregiver) is already `user.role_id` via provider.user_id, enforced by a trigger below
-- rather than duplicated and risking drift.
--
-- Design note (audit_log): as in Domains 1-2, no audit trigger is attached yet — Domain 9
-- must retrofit onto every table built so far before real data enters the system.

-- ── credential_type ──────────────────────────────────────────────────────────────────
-- Reference table (see Domain 1 `role` for the same pattern). New document types are a data
-- migration, not a schema migration.

create table credential_type (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  description text,
  expiry_period_months integer, -- null = does not expire (e.g. reference check); 12 for NMC PIN/AIN
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references "user"(id) -- nullable: seed rows below have no authenticated actor
);

create trigger credential_type_set_updated_at
  before update on credential_type
  for each row execute function public.set_updated_at();

insert into credential_type (slug, label, description, expiry_period_months) values
  ('ghana_card', 'Ghana Card', 'National ID (NIA) verification.', null),
  ('nmc_pin_ain', 'NMC PIN/AIN', 'Nursing and Midwifery Council of Ghana practising license. Expires every 12 months (CLAUDE.md guardrail): flag within 30 days of expiry, auto-suspend scheduling eligibility on lapse.', 12),
  ('police_report', 'Police Report', 'Criminal background clearance.', 12),
  ('reference_check', 'Reference Check', 'Prior-employer/character reference verification.', null),
  ('cpd_record', 'CPD Record', 'Continuing professional development / training completion record.', 12)
on conflict (slug) do nothing;

-- ── provider ─────────────────────────────────────────────────────────────────────────

create table provider (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references "user"(id),
  years_experience integer not null default 0 check (years_experience >= 0),
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create trigger provider_set_updated_at
  before update on provider
  for each row execute function public.set_updated_at();

-- A provider profile must belong to a user whose role is nurse or caregiver — catches a
-- coordinator data-entry mistake (e.g. accidentally onboarding a family_sponsor as a
-- provider) at the schema boundary instead of relying on UI validation alone.
create or replace function public.provider_enforce_role()
returns trigger
language plpgsql
as $$
declare
  target_role_slug text;
begin
  select r.slug into target_role_slug
  from "user" u
  join "role" r on r.id = u.role_id
  where u.id = new.user_id;

  if target_role_slug not in ('nurse', 'caregiver') then
    raise exception 'provider.user_id must reference a user with role nurse or caregiver (found: %)', target_role_slug;
  end if;

  return new;
end;
$$;

create trigger provider_enforce_role_trigger
  before insert or update of user_id on provider
  for each row execute function public.provider_enforce_role();

-- ── credential ───────────────────────────────────────────────────────────────────────

create table credential (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider(id),
  credential_type_id uuid not null references credential_type(id),
  issuing_authority text not null,
  status text not null default 'unverified' check (status in ('unverified', 'pending', 'verified', 'expired', 'rejected')),
  expiry_date date,
  evidence_document_ref text, -- Supabase Storage object path, not the file itself
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index credential_provider_id_idx on credential (provider_id);
create index credential_credential_type_id_idx on credential (credential_type_id);

create trigger credential_set_updated_at
  before update on credential
  for each row execute function public.set_updated_at();

-- ── credential_verification_event ───────────────────────────────────────────────────
-- Append-only-in-spirit audit trail of verification decisions on a credential. `occurred_at`
-- (when the verification happened, can be backdated by staff) is distinct from the generic
-- `created_at` audit column (when this row was inserted).

create table credential_verification_event (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references credential(id),
  outcome text not null check (outcome in ('unverified', 'pending', 'verified', 'expired', 'rejected')),
  notes text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index credential_verification_event_credential_id_idx on credential_verification_event (credential_id);

create trigger credential_verification_event_set_updated_at
  before update on credential_verification_event
  for each row execute function public.set_updated_at();

-- ── identity_verification ───────────────────────────────────────────────────────────
-- Vendor is a closed set today; the KYC vendor decision (Smile ID vs. Youverify) is still
-- open per carebridge-roadmap.md, so both are recorded as valid until that's settled.

create table identity_verification (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider(id),
  vendor text not null check (vendor in ('smile_id', 'youverify')),
  status text not null default 'unverified' check (status in ('unverified', 'pending', 'verified', 'expired', 'rejected')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index identity_verification_provider_id_idx on identity_verification (provider_id);

create trigger identity_verification_set_updated_at
  before update on identity_verification
  for each row execute function public.set_updated_at();

-- ── background_check ─────────────────────────────────────────────────────────────────

create table background_check (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider(id),
  status text not null default 'unverified' check (status in ('unverified', 'pending', 'verified', 'expired', 'rejected')),
  document_ref text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index background_check_provider_id_idx on background_check (provider_id);

create trigger background_check_set_updated_at
  before update on background_check
  for each row execute function public.set_updated_at();

-- ── training_record ──────────────────────────────────────────────────────────────────

create table training_record (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider(id),
  title text not null,
  cpd_points numeric(5, 2) not null default 0 check (cpd_points >= 0),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index training_record_provider_id_idx on training_record (provider_id);

create trigger training_record_set_updated_at
  before update on training_record
  for each row execute function public.set_updated_at();

-- ── verified_profile ─────────────────────────────────────────────────────────────────
-- One row per provider; see design note above re: manual/staff-maintained until the
-- credential-expiry cron Edge Function computes this automatically.

create table verified_profile (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null unique references provider(id),
  id_verified boolean not null default false,
  nmc_licensed boolean not null default false,
  background_checked boolean not null default false,
  training_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create trigger verified_profile_set_updated_at
  before update on verified_profile
  for each row execute function public.set_updated_at();

-- ── RLS helper functions ─────────────────────────────────────────────────────────────

create or replace function public.is_own_provider(target_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from provider p
    where p.id = target_provider_id and p.user_id = auth.uid()
  )
$$;

create or replace function public.owns_credential(target_credential_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from credential c
    join provider p on p.id = c.provider_id
    where c.id = target_credential_id and p.user_id = auth.uid()
  )
$$;

-- ── RLS: credential_type ─────────────────────────────────────────────────────────────

alter table credential_type enable row level security;

create policy credential_type_select_authenticated on credential_type
  for select
  to authenticated
  using (true);

create policy credential_type_write_staff on credential_type
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: provider ────────────────────────────────────────────────────────────────────

alter table provider enable row level security;

create policy provider_select_self_or_staff on provider
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy provider_write_staff on provider
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: credential ──────────────────────────────────────────────────────────────────

alter table credential enable row level security;

create policy credential_select_self_or_staff on credential
  for select
  to authenticated
  using (public.is_staff() or public.is_own_provider(provider_id));

create policy credential_write_staff on credential
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: credential_verification_event ──────────────────────────────────────────────

alter table credential_verification_event enable row level security;

create policy credential_verification_event_select_self_or_staff on credential_verification_event
  for select
  to authenticated
  using (public.is_staff() or public.owns_credential(credential_id));

create policy credential_verification_event_write_staff on credential_verification_event
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: identity_verification ──────────────────────────────────────────────────────

alter table identity_verification enable row level security;

create policy identity_verification_select_self_or_staff on identity_verification
  for select
  to authenticated
  using (public.is_staff() or public.is_own_provider(provider_id));

create policy identity_verification_write_staff on identity_verification
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: background_check ───────────────────────────────────────────────────────────

alter table background_check enable row level security;

create policy background_check_select_self_or_staff on background_check
  for select
  to authenticated
  using (public.is_staff() or public.is_own_provider(provider_id));

create policy background_check_write_staff on background_check
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: training_record ────────────────────────────────────────────────────────────

alter table training_record enable row level security;

create policy training_record_select_self_or_staff on training_record
  for select
  to authenticated
  using (public.is_staff() or public.is_own_provider(provider_id));

create policy training_record_write_staff on training_record
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: verified_profile ───────────────────────────────────────────────────────────

alter table verified_profile enable row level security;

create policy verified_profile_select_self_or_staff on verified_profile
  for select
  to authenticated
  using (public.is_staff() or public.is_own_provider(provider_id));

create policy verified_profile_write_staff on verified_profile
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── Grants ───────────────────────────────────────────────────────────────────────────

grant select on credential_type to authenticated;
grant insert, update, delete on credential_type to authenticated;

grant select, insert, update, delete on provider to authenticated;
grant select, insert, update, delete on credential to authenticated;
grant select, insert, update, delete on credential_verification_event to authenticated;
grant select, insert, update, delete on identity_verification to authenticated;
grant select, insert, update, delete on background_check to authenticated;
grant select, insert, update, delete on training_record to authenticated;
grant select, insert, update, delete on verified_profile to authenticated;
