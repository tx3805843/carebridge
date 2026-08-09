-- Security hardening: address Supabase security-advisor findings against the hosted
-- `carebridge` project (checked 2026-08-09).
--
-- Finding 1 (0028/0029, WARN): `is_staff`, `has_consent`, `is_linked_sponsor`,
-- `is_own_provider`, `owns_credential`, `current_role_slug`, `handle_new_auth_user`, and
-- `audit_row_change` are all `SECURITY DEFINER` and, because PostgREST exposes every
-- function in the `public` schema as a callable RPC endpoint, were directly reachable via
-- `/rest/v1/rpc/<name>` by `anon` and `authenticated` alike — bypassing the tables' RLS
-- entirely and turning e.g. `has_consent(client_id, scope)` into a consent-status oracle for
-- any client ID, not just ones the caller is linked to.
--
-- Fix: move them out of `public` into a new `internal` schema that PostgREST does not expose
-- (see `supabase/config.toml`, which only lists `public` under `[api] schemas`). This is
-- purely a namespace move — `ALTER FUNCTION ... SET SCHEMA` relocates the function object in
-- place, so every existing RLS policy and trigger (which reference the function by its
-- resolved OID, not by re-parsing the schema-qualified name at query time) keeps working
-- without modification. `authenticated`/`anon` still need `EXECUTE` on the functions to
-- evaluate RLS policies that call them — that grant is untouched by the schema move — but they
-- now need `USAGE` on the new schema too, which is not granted by default the way it is on
-- `public`.
--
-- Going forward: new migrations calling these helpers from RLS policies must use
-- `internal.<name>()`, not `public.<name>()`.
--
-- Finding 2 (0011, WARN): `set_updated_at` and `provider_enforce_role` had no pinned
-- `search_path`, the standard hardening against search-path-hijack attacks on functions
-- callable by roles that can create objects in schemas earlier in their search_path.
-- Fix: pin `search_path = public, pg_temp`.

create schema if not exists internal;

grant usage on schema internal to authenticated, anon;

alter function public.is_staff() set schema internal;
alter function public.has_consent(uuid, text) set schema internal;
alter function public.is_linked_sponsor(uuid) set schema internal;
alter function public.is_own_provider(uuid) set schema internal;
alter function public.owns_credential(uuid) set schema internal;
alter function public.current_role_slug() set schema internal;
alter function public.handle_new_auth_user() set schema internal;
alter function public.audit_row_change() set schema internal;

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.provider_enforce_role() set search_path = public, pg_temp;
