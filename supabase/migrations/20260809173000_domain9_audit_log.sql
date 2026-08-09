-- Domain 9 (partial) — Compliance & Audit: audit_log only, plus the generic trigger that
-- populates it, retrofitted onto every table created in Domains 1-3 so far. This is scoped
-- narrowly to close the CLAUDE.md guardrail ("Audit logging is via Postgres triggers into an
-- append-only audit_log — never rely on application code") before any real data enters the
-- system. `consent_record`, `dpc_registration`, `incident_report`, and `data_retention_policy`
-- are the rest of Domain 9 and are a separate future migration — not built here, don't treat
-- this file as "Domain 9 done."
--
-- Design note (writes only, not reads): a Postgres row-level trigger can fire on
-- INSERT/UPDATE/DELETE, not on SELECT — there is no mechanism to log "who viewed this row" at
-- the trigger level. This migration logs every write to every audited table. Auditing *read*
-- access to health data (e.g. "coordinator X viewed client Y's care plan on this date") would
-- need a different mechanism (e.g. the pgAudit extension, or API-level request logging) and is
-- an open decision, not silently covered by what's built here.
--
-- Design note (tamper-resistance): audit_log has no INSERT/UPDATE/DELETE grant to
-- `authenticated` at all — the only way a row gets in is through audit_row_change(), which is
-- SECURITY DEFINER (runs as the table owner, bypassing RLS) and is invoked only by the
-- triggers below, never called directly by client code. Nobody — including staff — can edit or
-- delete an audit row through the API.
--
-- Design note (actor may be null): actor_user_id/created_by are nullable, same reasoning as
-- `role.created_by`/`credential_type.created_by` in earlier migrations — a system-driven
-- change (migration seed data, a future cron Edge Function running as service_role) has no
-- auth.uid().

-- ── audit_log ────────────────────────────────────────────────────────────────────────

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid references "user"(id),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references "user"(id)
);

create index audit_log_table_name_record_id_idx on audit_log (table_name, record_id);
create index audit_log_occurred_at_idx on audit_log (occurred_at);

-- No update trigger: this table is append-only by design (see RLS below) — rows are never
-- updated after insert, so updated_at is expected to always equal created_at.

-- ── audit_row_change() ───────────────────────────────────────────────────────────────
-- Generic trigger function attached to every audited table below. Relies on every table in
-- this schema having a uuid primary key named `id` — true for all 17 tables audited here.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_record_id uuid;
begin
  if tg_op = 'DELETE' then
    affected_record_id := old.id;
  else
    affected_record_id := new.id;
  end if;

  insert into audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, created_by)
  values (
    tg_table_name,
    affected_record_id,
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

-- ── Retrofit: attach the audit trigger to every Domain 1-3 table ───────────────────────

create trigger role_audit after insert or update or delete on "role" for each row execute function public.audit_row_change();
create trigger user_audit after insert or update or delete on "user" for each row execute function public.audit_row_change();
create trigger family_sponsor_audit after insert or update or delete on family_sponsor for each row execute function public.audit_row_change();
create trigger client_relationship_audit after insert or update or delete on client_relationship for each row execute function public.audit_row_change();
create trigger consent_grant_audit after insert or update or delete on consent_grant for each row execute function public.audit_row_change();

create trigger client_audit after insert or update or delete on client for each row execute function public.audit_row_change();
create trigger care_plan_audit after insert or update or delete on care_plan for each row execute function public.audit_row_change();
create trigger emergency_contact_audit after insert or update or delete on emergency_contact for each row execute function public.audit_row_change();
create trigger decision_maker_hierarchy_audit after insert or update or delete on decision_maker_hierarchy for each row execute function public.audit_row_change();

create trigger credential_type_audit after insert or update or delete on credential_type for each row execute function public.audit_row_change();
create trigger provider_audit after insert or update or delete on provider for each row execute function public.audit_row_change();
create trigger credential_audit after insert or update or delete on credential for each row execute function public.audit_row_change();
create trigger credential_verification_event_audit after insert or update or delete on credential_verification_event for each row execute function public.audit_row_change();
create trigger identity_verification_audit after insert or update or delete on identity_verification for each row execute function public.audit_row_change();
create trigger background_check_audit after insert or update or delete on background_check for each row execute function public.audit_row_change();
create trigger training_record_audit after insert or update or delete on training_record for each row execute function public.audit_row_change();
create trigger verified_profile_audit after insert or update or delete on verified_profile for each row execute function public.audit_row_change();

-- ── RLS: audit_log ───────────────────────────────────────────────────────────────────
-- Staff-readable, nobody-writable (see design note above — writes only ever happen via the
-- SECURITY DEFINER trigger function, which bypasses RLS as the table owner).

alter table audit_log enable row level security;

create policy audit_log_select_staff on audit_log
  for select
  to authenticated
  using (public.is_staff());

-- Intentionally no INSERT/UPDATE/DELETE policy and no GRANT to `authenticated` beyond
-- SELECT — see tamper-resistance design note above.
grant select on audit_log to authenticated;
