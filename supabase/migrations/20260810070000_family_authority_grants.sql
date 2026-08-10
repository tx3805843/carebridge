-- Increment B0 — replaces client_relationship's is_decision_maker/is_billing_responsible
-- booleans with a polymorphic authority_grant table. Supervisor-tier per CLAUDE.md (schema
-- design, RLS/consent-model authorship, and financial logic — this migration rewrites
-- internal.is_billing_responsible_sponsor(), which gates real invoice/payment RLS). See
-- docs/superpowers/specs/2026-08-10-family-authority-grants-design.md and ADR-0005 for the
-- full rationale; this comment covers only what a future reader of this file needs.
--
-- Design note (why a new table, not new consent_grant scopes): consent_grant already exists
-- and already gates *read access* to clinical detail/photos/billing/location (CLAUDE.md:
-- "RLS resolves through consent_grant, not role alone"). Decision-maker/billing-responsible/
-- escort are a different kind of fact — real-world authority/responsibility, not read-access
-- — so they get their own table rather than overloading consent_grant with a second meaning.
-- health-update and photography authority stay exactly what they are today: consent_grant's
-- 'clinical_detail' and 'photos' scopes. emergency-contact stays the existing, already-separate
-- emergency_contact table. Neither changes in this migration.
--
-- Design note (client_relationship dropped, not kept as a bare link table): once the two
-- booleans move out it has zero non-redundant data — family_sponsor already uniquely links
-- (user_id, client_id) with a relationship label, and client_relationship.sponsor_id already
-- implies client_id through that same row. No RLS policy elsewhere keys off
-- client_relationship for base linkage (internal.is_linked_sponsor(), used by client/care_plan
-- RLS, already keys off family_sponsor directly). Existing rows are backfilled into
-- authority_grant below before the table is dropped, so no data is lost.

-- ── authority_grant ──────────────────────────────────────────────────────────────────

create table authority_grant (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  sponsor_id uuid not null references family_sponsor(id),
  authority_type text not null check (authority_type in ('decision_maker', 'billing_responsible', 'escort')),
  status text not null default 'active' check (status in ('pending', 'active', 'revoked', 'rejected')),
  evidence_document_ref text, -- Supabase Storage object path, same convention as credential.evidence_document_ref
  effective_from date,
  effective_until date,
  granted_at timestamptz,
  granted_by uuid references "user"(id),
  revoked_at timestamptz,
  revoked_by uuid references "user"(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create unique index authority_grant_active_unique
  on authority_grant (client_id, sponsor_id, authority_type)
  where status = 'active';
create index authority_grant_client_id_idx on authority_grant (client_id);
create index authority_grant_sponsor_id_idx on authority_grant (sponsor_id);

create trigger authority_grant_set_updated_at
  before update on authority_grant
  for each row execute function public.set_updated_at();

-- ── RLS: authority_grant ─────────────────────────────────────────────────────────────

alter table authority_grant enable row level security;

create policy authority_grant_select_self_or_staff on authority_grant
  for select
  to authenticated
  using (
    internal.is_staff()
    or exists (select 1 from family_sponsor fs where fs.id = sponsor_id and fs.user_id = auth.uid())
  );

create policy authority_grant_write_staff on authority_grant
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

create trigger authority_grant_audit after insert or update or delete on authority_grant for each row execute function internal.audit_row_change();

grant select, insert, update, delete on authority_grant to authenticated;
grant select, insert, update, delete on authority_grant to service_role;

-- ── Backfill existing client_relationship rows before dropping it ──────────────────────

insert into authority_grant (client_id, sponsor_id, authority_type, status, granted_at, granted_by, created_by)
select client_id, sponsor_id, 'decision_maker', 'active', created_at, created_by, created_by
from client_relationship
where is_decision_maker = true;

insert into authority_grant (client_id, sponsor_id, authority_type, status, granted_at, granted_by, created_by)
select client_id, sponsor_id, 'billing_responsible', 'active', created_at, created_by, created_by
from client_relationship
where is_billing_responsible = true;

-- ── Rewrite internal.is_billing_responsible_sponsor() off authority_grant ──────────────
-- Same signature/security posture as the original (20260810030000_domain8_billing_phase1.sql)
-- — only the body changes, so subscription/invoice/payment RLS policies that call this
-- function need no changes themselves.

create or replace function internal.is_billing_responsible_sponsor(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from authority_grant ag
    join family_sponsor fs on fs.id = ag.sponsor_id
    where ag.client_id = target_client_id
      and fs.user_id = auth.uid()
      and ag.authority_type = 'billing_responsible'
      and ag.status = 'active'
  )
$$;

-- ── Rewrite onboard_client_with_care_team() off authority_grant ────────────────────────
-- Same name/signature/security invoker as the original
-- (20260810050000_transactional_client_onboarding.sql) — apps/ops-console/app/clients/new/
-- actions.ts's RPC call and p_sponsors payload shape (is_decision_maker/is_billing_responsible
-- keys) are unchanged; only what happens inside the function changes.

create or replace function public.onboard_client_with_care_team(
  p_full_name text,
  p_date_of_birth date,
  p_address text,
  p_zone_id uuid,
  p_care_summary text,
  p_contacts jsonb, -- array of {full_name, phone}
  p_sponsors jsonb, -- array of {user_id, relationship, is_decision_maker, is_billing_responsible}
  p_referral_source text default null,
  p_review_due_at date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
  v_sponsor jsonb;
  v_family_sponsor_id uuid;
  v_priority int := 1;
begin
  insert into client (full_name, date_of_birth, address, zone_id, referral_source)
  values (p_full_name, p_date_of_birth, p_address, p_zone_id, p_referral_source)
  returning id into v_client_id;

  insert into care_plan (client_id, summary, review_due_at)
  values (v_client_id, p_care_summary, p_review_due_at);

  insert into emergency_contact (client_id, full_name, phone, priority)
  select v_client_id, c ->> 'full_name', c ->> 'phone', row_number() over ()
  from jsonb_array_elements(p_contacts) as c;

  for v_sponsor in select * from jsonb_array_elements(p_sponsors)
  loop
    insert into family_sponsor (user_id, client_id, relationship)
    values ((v_sponsor ->> 'user_id')::uuid, v_client_id, v_sponsor ->> 'relationship')
    returning id into v_family_sponsor_id;

    if (v_sponsor ->> 'is_decision_maker')::boolean then
      insert into authority_grant (client_id, sponsor_id, authority_type, status, granted_at, granted_by)
      values (v_client_id, v_family_sponsor_id, 'decision_maker', 'active', now(), auth.uid());

      insert into decision_maker_hierarchy (client_id, sponsor_id, priority)
      values (v_client_id, v_family_sponsor_id, v_priority);

      v_priority := v_priority + 1;
    end if;

    if (v_sponsor ->> 'is_billing_responsible')::boolean then
      insert into authority_grant (client_id, sponsor_id, authority_type, status, granted_at, granted_by)
      values (v_client_id, v_family_sponsor_id, 'billing_responsible', 'active', now(), auth.uid());
    end if;
  end loop;

  return v_client_id;
end;
$$;

-- ── Drop client_relationship (superseded by authority_grant, backfilled above) ─────────

drop table client_relationship;
