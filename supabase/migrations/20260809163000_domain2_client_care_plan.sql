-- Domain 2 — Client & Care Plan: client, care_plan, emergency_contact,
-- decision_maker_hierarchy. See docs/domain-model.md and packages/db/README.md.
--
-- Design note (client_id backfill): the Domain 1 migration left family_sponsor.client_id,
-- client_relationship.client_id, and consent_grant.client_id as unconstrained uuid columns
-- because `client` didn't exist yet. This migration adds the FK constraints now.
--
-- Design note (zone_id forward reference): client.zone_id points at `zone`, a Domain 4
-- (Scheduling & Visit Ops) table that doesn't exist yet. Same pattern as Domain 1: plain
-- `uuid not null` here, FK constraint added when Domain 4 lands.
--
-- Design note (clinical detail vs. structural data): care_plan is clinical content, so
-- reading it requires an explicit consent_grant (scope='clinical_detail'), not just a
-- family_sponsor link — this is the guardrail's core scenario (CLAUDE.md: "a family sponsor
-- with a role still needs an explicit consent grant to read clinical detail"). client,
-- emergency_contact, and decision_maker_hierarchy are structural/safety data ("who is this
-- person, who to call, who decides") that a linked sponsor can see without a separate grant.
--
-- Design note (audit_log): as in Domain 1, no audit trigger is attached yet — Domain 9 must
-- retrofit onto every table created so far before real data enters the system.
--
-- Design note (nurse/caregiver write access): care_plan writes are staff-only
-- (coordinator/clinical_director/admin) here, matching the Domain 1 decision to defer
-- nurse/caregiver access until it can be scoped through visit/assignment tables (Domain 4/5),
-- not granted broadly by role.

-- ── client ───────────────────────────────────────────────────────────────────────────

create table client (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  date_of_birth date not null,
  address text not null,
  zone_id uuid not null, -- FK to zone(id) added once Domain 4 lands
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index client_zone_id_idx on client (zone_id);

create trigger client_set_updated_at
  before update on client
  for each row execute function public.set_updated_at();

-- Backfill the FK constraints deferred from the Domain 1 migration, now that client exists.
alter table family_sponsor
  add constraint family_sponsor_client_id_fkey foreign key (client_id) references client(id);
alter table client_relationship
  add constraint client_relationship_client_id_fkey foreign key (client_id) references client(id);
alter table consent_grant
  add constraint consent_grant_client_id_fkey foreign key (client_id) references client(id);

-- ── care_plan ────────────────────────────────────────────────────────────────────────
-- Multiple rows per client over time (a care plan history), not a single mutable row —
-- "current" is the most recent by effective_from. No status/versioning workflow yet; add
-- one only when a real story needs it.

create table care_plan (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  summary text not null,
  effective_from date not null default current_date,
  review_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index care_plan_client_id_idx on care_plan (client_id);

create trigger care_plan_set_updated_at
  before update on care_plan
  for each row execute function public.set_updated_at();

-- ── emergency_contact ────────────────────────────────────────────────────────────────

create table emergency_contact (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  full_name text not null,
  phone text not null,
  priority integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create unique index emergency_contact_client_priority_unique on emergency_contact (client_id, priority);

create trigger emergency_contact_set_updated_at
  before update on emergency_contact
  for each row execute function public.set_updated_at();

-- ── decision_maker_hierarchy ─────────────────────────────────────────────────────────
-- Orders multiple decision-makers by priority for a client. Whether a given sponsor *is* a
-- decision-maker at all is client_relationship.is_decision_maker (Domain 1); this table only
-- orders among those who are.

create table decision_maker_hierarchy (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  sponsor_id uuid not null references family_sponsor(id),
  priority integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create unique index decision_maker_hierarchy_client_priority_unique on decision_maker_hierarchy (client_id, priority);
create unique index decision_maker_hierarchy_client_sponsor_unique on decision_maker_hierarchy (client_id, sponsor_id);

create trigger decision_maker_hierarchy_set_updated_at
  before update on decision_maker_hierarchy
  for each row execute function public.set_updated_at();

-- ── RLS helper functions ─────────────────────────────────────────────────────────────

create or replace function public.is_linked_sponsor(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from family_sponsor fs
    where fs.client_id = target_client_id
      and fs.user_id = auth.uid()
  )
$$;

create or replace function public.has_consent(target_client_id uuid, required_scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from consent_grant cg
    where cg.client_id = target_client_id
      and cg.grantee_user_id = auth.uid()
      and cg.scope = required_scope
      and cg.revoked_at is null
  )
$$;

-- ── RLS: client ──────────────────────────────────────────────────────────────────────

alter table client enable row level security;

create policy client_select_linked_or_staff on client
  for select
  to authenticated
  using (public.is_staff() or public.is_linked_sponsor(id));

create policy client_write_staff on client
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: care_plan ───────────────────────────────────────────────────────────────────

alter table care_plan enable row level security;

create policy care_plan_select_consented_or_staff on care_plan
  for select
  to authenticated
  using (
    public.is_staff()
    or (public.is_linked_sponsor(client_id) and public.has_consent(client_id, 'clinical_detail'))
  );

create policy care_plan_write_staff on care_plan
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: emergency_contact ───────────────────────────────────────────────────────────

alter table emergency_contact enable row level security;

create policy emergency_contact_select_linked_or_staff on emergency_contact
  for select
  to authenticated
  using (public.is_staff() or public.is_linked_sponsor(client_id));

create policy emergency_contact_write_staff on emergency_contact
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── RLS: decision_maker_hierarchy ────────────────────────────────────────────────────

alter table decision_maker_hierarchy enable row level security;

create policy decision_maker_hierarchy_select_linked_or_staff on decision_maker_hierarchy
  for select
  to authenticated
  using (public.is_staff() or public.is_linked_sponsor(client_id));

create policy decision_maker_hierarchy_write_staff on decision_maker_hierarchy
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── Grants ───────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on client to authenticated;
grant select, insert, update, delete on care_plan to authenticated;
grant select, insert, update, delete on emergency_contact to authenticated;
grant select, insert, update, delete on decision_maker_hierarchy to authenticated;
