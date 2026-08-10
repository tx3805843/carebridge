-- Fixes a real bug found 2026-08-10 while running a pilot-family cycle against hosted
-- `carebridge`: `app/clients/new/actions.ts` wrote client / care_plan / emergency_contact /
-- family_sponsor / client_relationship / decision_maker_hierarchy as separate PostgREST
-- requests (each its own transaction). A failure partway through — in that incident,
-- `createAdminClient()` throwing on a missing service-role key, but any of the six inserts
-- failing has the same effect — left an orphaned client row with no care plan, no contacts,
-- or no sponsor, and no way to recover except a manual fix. See carebridge-roadmap.md's
-- Phase 1 changelog and "Open questions" for the incident (orphan client
-- f33e6586-5173-4b62-9324-3b89d81c2450 on hosted).
--
-- Fix: one RPC that does all six inserts inside a single Postgres transaction. `security
-- invoker` (the default) deliberately, not `security definer` — every insert still runs as
-- the calling user and is still gated by that table's existing staff-only RLS policy, so this
-- adds no privilege a direct insert didn't already have; it only adds atomicity. Safe to expose
-- in `public` (unlike the security-hardening migration's RLS-helper functions, which were
-- moved out of `public` specifically because they were `security definer` and would have
-- bypassed RLS if callable via PostgREST RPC — this function has no such risk).
--
-- Auth-account creation for a new sponsor (`auth.admin.createUser`, a GoTrue API call, not SQL)
-- still can't be part of this transaction — it isn't a database operation. The corresponding
-- app-code change resolves every sponsor's user_id (existing lookup or new admin-created
-- account) *before* calling this function at all, so a failure there now leaves zero rows
-- written, instead of happening after three of the six inserts already succeeded.

create function public.onboard_client_with_care_team(
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

    insert into client_relationship (client_id, sponsor_id, is_decision_maker, is_billing_responsible)
    values (
      v_client_id,
      v_family_sponsor_id,
      (v_sponsor ->> 'is_decision_maker')::boolean,
      (v_sponsor ->> 'is_billing_responsible')::boolean
    );

    if (v_sponsor ->> 'is_decision_maker')::boolean then
      insert into decision_maker_hierarchy (client_id, sponsor_id, priority)
      values (v_client_id, v_family_sponsor_id, v_priority);

      v_priority := v_priority + 1;
    end if;
  end loop;

  return v_client_id;
end;
$$;
