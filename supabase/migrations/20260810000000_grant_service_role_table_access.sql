-- Fix: service_role has never had table-level privileges on any table in this schema.
-- Found while building the whatsapp-webhook Edge Function (Phase 1, WhatsApp epic Story 3) —
-- its first direct PostgREST table query as service_role failed with
-- "permission denied for table whatsapp_message_log", and a broader check confirmed the gap
-- is repo-wide: every Domain 1-7 migration granted table access to `authenticated` only,
-- never to `service_role`.
--
-- This is an accidental gap, not an intentional restriction. `service_role` has
-- `BYPASSRLS = true` (confirmed via pg_roles) — Supabase's designed "trusted backend, RLS
-- doesn't apply" role. Table-level GRANTs are a separate permission layer from RLS policies,
-- so BYPASSRLS alone doesn't give it table access; it also needs the same GRANTs every
-- migration already gave `authenticated`. Until now, no code path had ever used service_role
-- for a direct table query (apps/ops-console/lib/supabase/admin.ts's service-role client only
-- calls the Auth Admin API, which goes through GoTrue, not PostgREST table grants) — so this
-- shipped unnoticed since Phase 0. Left unfixed, every future service-role Edge Function
-- (escalation-engine, credential-expiry-cron, invoice-generator — all still TODO stubs) would
-- hit the same wall the moment it tried to touch a table.
--
-- Mirrors the exact same per-table grant shape each domain migration already gave
-- `authenticated` — same tables, same privilege lists, including audit_log's deliberate
-- SELECT-only grant (no direct INSERT: the tamper-resistance design in
-- 20260809173000_domain9_audit_log.sql relies on only the SECURITY DEFINER trigger function
-- ever writing that table, and a SECURITY DEFINER function's privileges come from its owner,
-- not the caller — so service_role doesn't need an INSERT grant for the trigger to keep
-- working, and definitely shouldn't get one).

grant select on audit_log to service_role;

grant select on "role" to service_role;
grant insert, update, delete on "role" to service_role;
grant select, update on "user" to service_role;
grant select, insert, update, delete on family_sponsor to service_role;
grant select, insert, update, delete on client_relationship to service_role;
grant select, insert, update, delete on consent_grant to service_role;

grant select, insert, update, delete on client to service_role;
grant select, insert, update, delete on care_plan to service_role;
grant select, insert, update, delete on emergency_contact to service_role;
grant select, insert, update, delete on decision_maker_hierarchy to service_role;

grant select on credential_type to service_role;
grant insert, update, delete on credential_type to service_role;
grant select, insert, update, delete on provider to service_role;
grant select, insert, update, delete on credential to service_role;
grant select, insert, update, delete on credential_verification_event to service_role;
grant select, insert, update, delete on identity_verification to service_role;
grant select, insert, update, delete on background_check to service_role;
grant select, insert, update, delete on training_record to service_role;
grant select, insert, update, delete on verified_profile to service_role;

grant select, insert, update, delete on consent_record to service_role;
grant select, insert, update, delete on dpc_registration to service_role;
grant select, insert, update, delete on incident_report to service_role;
grant select, insert, update, delete on data_retention_policy to service_role;

grant select, insert, update, delete on zone to service_role;
grant select, insert, update, delete on roster to service_role;
grant select, insert, update, delete on visit to service_role;
grant select, insert, update, delete on visit_checkin to service_role;
grant select, insert, update, delete on observation to service_role;
grant select, insert, update, delete on task to service_role;

grant select, insert, update, delete on alert_rule to service_role;
grant select, insert, update, delete on escalation to service_role;
grant select, insert, update, delete on notification to service_role;
grant select, insert, update, delete on whatsapp_message_log to service_role;
