-- Fix a regression from 20260809180000_security_hardening.sql: is_staff() calls
-- current_role_slug() with a hardcoded `public.` qualifier. ALTER FUNCTION ... SET SCHEMA
-- relocates a function's own catalog entry, but does NOT rewrite literal schema-qualified
-- references to *other* functions inside a `language sql` function's body — unlike RLS
-- policies and triggers (which store a resolved function OID), a SQL-language function body
-- is text that gets re-resolved against its declared search_path plus any explicit
-- qualification on every call. Because current_role_slug moved out of `public`, every call to
-- is_staff() has been raising `function public.current_role_slug() does not exist` since that
-- migration landed — silently breaking every staff-gated RLS policy in the schema for real
-- authenticated sessions. Not caught at the time because that migration's verification checked
-- grants and get_advisors, not an actual role-impersonated query. Found while functionally
-- verifying the Domain 4 migration's RLS (20260809190000) with a real coordinator/nurse
-- session — this is schema-wide, not specific to Domain 4.
--
-- Fix: repoint the call at internal.current_role_slug(), the function's current location.

create or replace function internal.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(internal.current_role_slug() in ('coordinator', 'clinical_director', 'admin'), false)
$$;
