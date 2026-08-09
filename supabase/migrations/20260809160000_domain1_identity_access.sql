-- Domain 1 — Identity & Access: user, role, family_sponsor, client_relationship,
-- consent_grant. See docs/domain-model.md and packages/db/README.md.
--
-- Design note (client_id forward references): family_sponsor, client_relationship, and
-- consent_grant all scope to a client, but `client` is a Domain 2 table that does not exist
-- yet. Their client_id columns are plain `uuid not null` here; the Domain 2 migration must
-- add the FK constraint once `client` exists (tracked in carebridge-roadmap.md).
--
-- Design note (audit_log): CLAUDE.md requires audit logging via Postgres triggers into an
-- append-only audit_log table. That table is Domain 9 (Compliance & Audit) and does not
-- exist yet, so no audit trigger is attached to these tables in this migration. The Domain 9
-- migration must retrofit audit triggers onto every Domain 1-3 table before real data enters
-- the system (see CLAUDE.md guardrail and roadmap Phase 0 exit criteria).

-- ── Utilities (shared by every future domain migration) ────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── role ─────────────────────────────────────────────────────────────────────────────
-- Reference table, not an enum: new roles (e.g. a future "ops_admin") should be a data
-- migration, not a schema migration. Seeded here as schema-contract reference data — distinct
-- from packages/db/seed/, which holds synthetic dev fixtures (clients, providers, etc.).

create table "role" (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid -- nullable: seed rows below have no authenticated actor; FK to user(id) added below once "user" exists
);

create trigger role_set_updated_at
  before update on "role"
  for each row execute function public.set_updated_at();

-- ── user ─────────────────────────────────────────────────────────────────────────────
-- 1:1 with auth.users. Row is created by the handle_new_auth_user trigger below, never
-- inserted directly by client code (no INSERT RLS policy is granted for that reason).

create table "user" (
  id uuid primary key references auth.users(id) on delete cascade,
  role_id uuid not null references "role"(id),
  full_name text not null default '',
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references "user"(id) -- self-authored at signup; see trigger below
);

create unique index user_email_unique on "user" (lower(email)) where email is not null;
create index user_role_id_idx on "user" (role_id);

create trigger user_set_updated_at
  before update on "user"
  for each row execute function public.set_updated_at();

-- Deferred FK now that "user" exists: role.created_by -> user.id
alter table "role"
  add constraint role_created_by_fkey foreign key (created_by) references "user"(id);

-- Seed the fixed role vocabulary (idempotent).
insert into "role" (slug, label, description) values
  ('coordinator', 'Coordinator', 'Runs day-to-day scheduling, onboarding, and the exception queue.'),
  ('clinical_director', 'Clinical Director', 'Clinical oversight; routes and resolves incident reports.'),
  ('nurse', 'Nurse', 'Delivers and supervises nursing-scope care visits.'),
  ('caregiver', 'Caregiver', 'Delivers non-clinical home care visits.'),
  ('family_sponsor', 'Family Sponsor', 'Diaspora or local family member paying for / overseeing a client''s care.'),
  ('admin', 'Admin', 'Platform administration; full access.')
on conflict (slug) do nothing;

-- Auto-create the public.user profile row when someone signs up via Supabase Auth.
-- Defaults to the family_sponsor role; staff accounts are created by an admin/coordinator
-- invite flow that passes an explicit role_id in raw_user_meta_data (that invite flow is a
-- later Phase 1 story, not built yet — see carebridge-roadmap.md).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role_id uuid;
begin
  select coalesce(
    (new.raw_user_meta_data->>'role_id')::uuid,
    (select id from "role" where slug = 'family_sponsor')
  ) into target_role_id;

  insert into "user" (id, role_id, full_name, email, phone, created_by)
  values (
    new.id,
    target_role_id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    new.raw_user_meta_data->>'phone',
    new.id
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ── family_sponsor ───────────────────────────────────────────────────────────────────
-- Links a user (expected role: family_sponsor) to a client they sponsor. Created by staff
-- during onboarding, not self-service.

create table family_sponsor (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  client_id uuid not null, -- FK to client(id) added in Domain 2 migration
  relationship text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create unique index family_sponsor_user_client_unique on family_sponsor (user_id, client_id);
create index family_sponsor_client_id_idx on family_sponsor (client_id);

create trigger family_sponsor_set_updated_at
  before update on family_sponsor
  for each row execute function public.set_updated_at();

-- ── client_relationship ──────────────────────────────────────────────────────────────
-- Marks whether a given sponsor is a decision-maker and/or billing-responsible for a client.
-- Ordering multiple decision-makers by priority is decision_maker_hierarchy (Domain 2).

create table client_relationship (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null, -- FK to client(id) added in Domain 2 migration
  sponsor_id uuid not null references family_sponsor(id),
  is_decision_maker boolean not null default false,
  is_billing_responsible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create unique index client_relationship_client_sponsor_unique on client_relationship (client_id, sponsor_id);
create index client_relationship_client_id_idx on client_relationship (client_id);

create trigger client_relationship_set_updated_at
  before update on client_relationship
  for each row execute function public.set_updated_at();

-- ── consent_grant ────────────────────────────────────────────────────────────────────
-- The mechanism every RLS policy on clinical/sensitive data must resolve through — a role
-- alone never implies access. text + check constraint (not an enum) so new scopes can be
-- added with a plain migration, not an ALTER TYPE.

create table consent_grant (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null, -- FK to client(id) added in Domain 2 migration
  grantee_user_id uuid not null references "user"(id),
  scope text not null check (scope in ('clinical_detail', 'billing', 'location_tracking', 'photos')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

-- Only one active (unrevoked) grant per client/grantee/scope.
create unique index consent_grant_active_unique
  on consent_grant (client_id, grantee_user_id, scope)
  where revoked_at is null;
create index consent_grant_client_id_idx on consent_grant (client_id);
create index consent_grant_grantee_user_id_idx on consent_grant (grantee_user_id);

create trigger consent_grant_set_updated_at
  before update on consent_grant
  for each row execute function public.set_updated_at();

-- ── RLS helper functions ─────────────────────────────────────────────────────────────
-- security definer + fixed search_path so these can read "user"/"role" without recursing
-- into the RLS policies defined on those same tables (Supabase-recommended pattern).

create or replace function public.current_role_slug()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.slug
  from "user" u
  join "role" r on r.id = u.role_id
  where u.id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role_slug() in ('coordinator', 'clinical_director', 'admin'), false)
$$;

-- Nurse/caregiver visibility is intentionally NOT granted broad identity access here — it
-- will be scoped through visit/assignment tables in a later domain, not role alone.

-- ── RLS: role ────────────────────────────────────────────────────────────────────────

alter table "role" enable row level security;

create policy role_select_authenticated on "role"
  for select
  to authenticated
  using (true);

create policy role_write_staff on "role"
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: user ────────────────────────────────────────────────────────────────────────

alter table "user" enable row level security;

create policy user_select_self_or_staff on "user"
  for select
  to authenticated
  using (id = auth.uid() or public.is_staff());

create policy user_update_self_or_staff on "user"
  for update
  to authenticated
  using (id = auth.uid() or public.is_staff())
  with check (id = auth.uid() or public.is_staff());

-- No INSERT/DELETE policy: rows are created only by the handle_new_auth_user trigger
-- (security definer, bypasses RLS) and are never hard-deleted.

-- ── RLS: family_sponsor ──────────────────────────────────────────────────────────────

alter table family_sponsor enable row level security;

create policy family_sponsor_select_self_or_staff on family_sponsor
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy family_sponsor_write_staff on family_sponsor
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: client_relationship ─────────────────────────────────────────────────────────

alter table client_relationship enable row level security;

create policy client_relationship_select_self_or_staff on client_relationship
  for select
  to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from family_sponsor fs
      where fs.id = client_relationship.sponsor_id
        and fs.user_id = auth.uid()
    )
  );

create policy client_relationship_write_staff on client_relationship
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: consent_grant ───────────────────────────────────────────────────────────────
-- Staff-only write: consent grants are captured/revoked by a coordinator or clinical
-- director at onboarding, not self-service by family sponsors. Grantees may read their own
-- grants (so the UI can show what they've been given access to) but not anyone else's.

alter table consent_grant enable row level security;

create policy consent_grant_select_self_or_staff on consent_grant
  for select
  to authenticated
  using (grantee_user_id = auth.uid() or public.is_staff());

create policy consent_grant_write_staff on consent_grant
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── Grants ───────────────────────────────────────────────────────────────────────────
-- Table-level privileges; RLS policies above still gate row visibility per-statement.

grant select on "role" to authenticated;
grant insert, update, delete on "role" to authenticated;

grant select, update on "user" to authenticated;

grant select, insert, update, delete on family_sponsor to authenticated;
grant select, insert, update, delete on client_relationship to authenticated;
grant select, insert, update, delete on consent_grant to authenticated;
