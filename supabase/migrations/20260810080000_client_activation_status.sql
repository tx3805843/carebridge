-- Increment B3 — gives `client` a real status lifecycle for the first time (nothing today
-- can ever mark a client inactive) and backs "active" with a database-enforced invariant
-- over the structural facts that actually exist as rows: an emergency contact, a care plan,
-- and an active authority grant. Supervisor-tier per CLAUDE.md (schema design). See
-- docs/superpowers/specs/2026-08-10-client-activation-b3-design.md for full rationale.
--
-- Design note (why not "supervisor review" / "approved care plan"): the review mockup names
-- five gates, but two of them — supervisor review, care-plan approval — have no entity
-- anywhere in this schema (no care_plan.status, no review/approval table). Increment B1
-- already declined to fake those two states for the same reason Increment A0 fixed the false
-- "Send invite" copy: a UI element implying a workflow that doesn't run is worse than none.
-- This migration checks the three gates that correspond to real rows instead.
--
-- Design note (why the RPC's last statement, not the first insert): the initial
-- `insert into client` gets this column's `'inactive'` default. onboard_client_with_care_team
-- (20260810070000_family_authority_grants.sql) already inserts care_plan/emergency_contact/
-- authority_grant rows for that same client afterward, in the same transaction. Only once all
-- of those have landed does the RPC's final `update client set status = 'active'` run — at
-- that point the trigger sees the complete picture. This also means the invariant holds even
-- for a future second creation path that forgets to replicate the wizard's own client-side
-- checklist (apps/ops-console/app/clients/new/client-form.tsx) — the database, not just the
-- UI, refuses an incomplete "active" client.

alter table client
  add column status text not null default 'inactive'
    check (status in ('active', 'inactive'));

create function internal.check_client_activation_ready(target_client_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from emergency_contact where client_id = target_client_id)
    and exists (select 1 from care_plan where client_id = target_client_id)
    and exists (
      select 1 from authority_grant
      where client_id = target_client_id and status = 'active'
    )
$$;

create function public.enforce_client_activation_ready()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' and (old is null or old.status is distinct from 'active') then
    if not internal.check_client_activation_ready(new.id) then
      raise exception
        'Client % cannot be activated: requires at least one emergency contact, one care plan, and one active authority grant',
        new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger client_enforce_activation_ready
  before insert or update on client
  for each row execute function public.enforce_client_activation_ready();

-- ── Rewrite onboard_client_with_care_team() to activate on success ─────────────────────
-- Same name/signature/security invoker as the previous version
-- (20260810070000_family_authority_grants.sql) — apps/ops-console/app/clients/new/actions.ts
-- needs zero changes. Only the new final statement changes: once every other row in this
-- transaction has landed, flip the client active. If that update's trigger check somehow
-- fails, the whole transaction (including the client/care_plan/emergency_contact/
-- authority_grant inserts already made) rolls back — nothing is left half-built.

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

  update client set status = 'active' where id = v_client_id;

  return v_client_id;
end;
$$;
