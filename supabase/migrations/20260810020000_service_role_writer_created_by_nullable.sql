-- Two columns were `not null default auth.uid()`, assuming every insert happens within a
-- staff/session request context. whatsapp_message_log already made this exact call nullable
-- (see its own migration comment, 20260809210000) for service_role-only writers with no
-- auth.uid(). The new credential-expiry-cron Edge Function (runs purely as service_role, no
-- user session) is the first real writer to hit the same wall on these two:
--   - notification: inserted by credential-expiry-cron when auto-suspending a provider.
--   - credential_verification_event: inserted by credential-expiry-cron when auto-expiring a
--     lapsed credential.
-- Bring both in line with whatsapp_message_log's precedent.

alter table notification alter column created_by drop not null;
alter table credential_verification_event alter column created_by drop not null;
