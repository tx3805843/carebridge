-- Schedules the credential-expiry-cron Edge Function daily via pg_cron + pg_net, implementing
-- CLAUDE.md's "Credential expiry is enforced by a cron Edge Function, not a UI reminder"
-- guardrail. See supabase/functions/credential-expiry-cron/index.ts for the actual logic
-- (30-day expiry flagging, auto-expire past expiry_date, auto-suspend NMC scheduling
-- eligibility on lapse).
--
-- Security note: the Authorization header is a dedicated CRON_SECRET, deliberately NOT the
-- project's service-role key — a leaked/misconfigured cron secret can only trigger this one
-- function, not read/write the whole database. Its value is pulled from Supabase Vault at
-- run time (never embedded in this migration file, which is checked into a public repo), so
-- this migration works even before the secret exists — the scheduled job will just send an
-- empty bearer token and get a correct 401 from the function's own fail-closed check until
-- the secret is set. Two things must be done out-of-band after this migration runs (same
-- pattern as WHATSAPP_APP_SECRET / GitHub Actions secrets elsewhere in this project — never
-- committed):
--   1. `select vault.create_secret('<random-value>', 'credential_expiry_cron_secret');`
--   2. `supabase secrets set CRON_SECRET=<same random-value>` (so the Edge Function checks
--      against the same value the cron job sends).

create extension if not exists pg_cron with schema extensions;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select
  cron.schedule(
    'credential-expiry-daily',
    '17 3 * * *', -- 03:17 UTC daily; off the top of the hour to avoid the cron pileup window
    $$
    select net.http_post(
      url := 'https://rqnyleqluzblupfnsfmt.functions.supabase.co/credential-expiry-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'credential_expiry_cron_secret'),
          ''
        )
      ),
      body := '{}'::jsonb
    );
    $$
  );
