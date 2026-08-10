-- Local-dev seed data: realistic-but-synthetic Ghanaian fixtures (CLAUDE.md: "Never develop
-- against real client PII"). Auto-applied by `supabase db reset` / `supabase start` (Supabase
-- CLI convention — this file's location and name are fixed, not configurable). Idempotent:
-- every row uses a fixed UUID and an `on conflict ... do nothing`, so re-running this file
-- against an already-seeded database is a no-op rather than a pile of duplicates.
--
-- Fixed UUID scheme (single hex digit / short suffix distinguishes rows within a table):
--   a0000000-...-00000000000X  auth.users / user            (X = 0-9,a-f, 16 people)
--   b0000000-...-00000000000N  client                        (N = 1-5)
--   c0000000-...-00000000000N  provider                      (N = 1-6)
--   d0000000-...-000000000001  zone (Domain 4)
--   e1..e9 000000-...           one prefix per detail table (care_plan, consent_record,
--                               credential, credential_verification_event,
--                               identity_verification, background_check, training_record,
--                               incident_report, dpc_registration)
-- Runs as postgres (bypasses RLS), same as every migration.

-- ── People (auth.users -> user via handle_new_auth_user trigger) ───────────────────────
-- role_id is passed through raw_user_meta_data; the trigger (Domain 1 migration) reads it and
-- falls back to family_sponsor when absent — so sponsors below omit role_id entirely.

insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change, email_confirmed_at, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000000', 'admin@carebridge.dev', jsonb_build_object('full_name', 'Kwame Owusu', 'phone', '+233244000000', 'role_id', (select id from "role" where slug = 'admin')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000001', 'coordinator1@carebridge.dev', jsonb_build_object('full_name', 'Abena Frimpong', 'phone', '+233244000001', 'role_id', (select id from "role" where slug = 'coordinator')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000002', 'coordinator2@carebridge.dev', jsonb_build_object('full_name', 'Yaw Boateng', 'phone', '+233244000002', 'role_id', (select id from "role" where slug = 'coordinator')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000003', 'director@carebridge.dev', jsonb_build_object('full_name', 'Dr. Efua Mensah', 'phone', '+233244000003', 'role_id', (select id from "role" where slug = 'clinical_director')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000004', 'nurse1@carebridge.dev', jsonb_build_object('full_name', 'Adjoa Asante', 'phone', '+233244000004', 'role_id', (select id from "role" where slug = 'nurse')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000005', 'nurse2@carebridge.dev', jsonb_build_object('full_name', 'Kofi Owusu', 'phone', '+233244000005', 'role_id', (select id from "role" where slug = 'nurse')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000006', 'nurse3@carebridge.dev', jsonb_build_object('full_name', 'Akosua Darko', 'phone', '+233244000006', 'role_id', (select id from "role" where slug = 'nurse')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000007', 'caregiver1@carebridge.dev', jsonb_build_object('full_name', 'Kwabena Appiah', 'phone', '+233244000007', 'role_id', (select id from "role" where slug = 'caregiver')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000008', 'caregiver2@carebridge.dev', jsonb_build_object('full_name', 'Ama Boateng', 'phone', '+233244000008', 'role_id', (select id from "role" where slug = 'caregiver')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000009', 'caregiver3@carebridge.dev', jsonb_build_object('full_name', 'Yaa Asantewaa', 'phone', '+233244000009', 'role_id', (select id from "role" where slug = 'caregiver')), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a000000a-0000-0000-0000-00000000000a', 'yaw.asante@example.co.uk', jsonb_build_object('full_name', 'Yaw Asante', 'phone', '+441234500001'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a000000b-0000-0000-0000-00000000000b', 'adjoa.ntim@example.com', jsonb_build_object('full_name', 'Adjoa Ntim', 'phone', '+233244000011'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a000000c-0000-0000-0000-00000000000c', 'kojo.serwaa@example.com', jsonb_build_object('full_name', 'Kojo Serwaa', 'phone', '+12025550001'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a000000d-0000-0000-0000-00000000000d', 'abena.owusu@example.com', jsonb_build_object('full_name', 'Abena Owusu-Serwaa', 'phone', '+233244000013'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a000000e-0000-0000-0000-00000000000e', 'nii.adjei@example.com', jsonb_build_object('full_name', 'Nii Adjei', 'phone', '+233244000014'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now()),
  ('a000000f-0000-0000-0000-00000000000f', 'akosua.nyarko@example.ca', jsonb_build_object('full_name', 'Akosua Nyarko', 'phone', '+16135550001'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', now(), now(), now())
on conflict (id) do nothing;

-- ── Zone (Domain 4) ──────────────────────────────────────────────────────────────────
-- Single zone at pilot scale; client.zone_id below now has a real FK target
-- (client_zone_id_fkey, added in the Domain 4 migration).

insert into zone (id, name, created_by) values
  ('d0000000-0000-0000-0000-000000000001', 'Accra Central', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ── Clients ──────────────────────────────────────────────────────────────────────────

insert into client (id, full_name, date_of_birth, address, zone_id, created_by) values
  ('b0000000-0000-0000-0000-000000000001', 'Efua Asante', '1944-03-12', 'Osu, Accra', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'Kwabena Ntim', '1950-07-22', 'Dansoman, Accra', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000003', 'Akua Serwaa', '1936-11-02', 'East Legon, Accra', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000004', 'Kofi Adjei', '1954-01-30', 'Tema, Greater Accra', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000005', 'Abena Nyarko', '1941-09-15', 'Adenta, Accra', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ── Family sponsors + relationships + decision-maker hierarchy + emergency contacts ────
-- Akua Serwaa (client 3) has two sponsors, to exercise decision_maker_hierarchy ordering.

insert into family_sponsor (user_id, client_id, relationship, created_by) values
  ('a000000a-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 'son', 'a0000000-0000-0000-0000-000000000001'),
  ('a000000b-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000002', 'daughter', 'a0000000-0000-0000-0000-000000000001'),
  ('a000000c-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-000000000003', 'son', 'a0000000-0000-0000-0000-000000000002'),
  ('a000000d-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-000000000003', 'granddaughter', 'a0000000-0000-0000-0000-000000000002'),
  ('a000000e-0000-0000-0000-00000000000e', 'b0000000-0000-0000-0000-000000000004', 'son', 'a0000000-0000-0000-0000-000000000002'),
  ('a000000f-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-000000000005', 'daughter', 'a0000000-0000-0000-0000-000000000001')
on conflict (user_id, client_id) do nothing;

-- Literal uuid columns are cast explicitly (::uuid) in every branch below: Postgres resolves
-- an untyped string constant across a UNION ALL to `text`, and text -> uuid is not an
-- implicit/assignment cast for an INSERT ... SELECT (unlike a plain INSERT ... VALUES, where
-- the target column type drives the cast directly).
insert into client_relationship (client_id, sponsor_id, is_decision_maker, is_billing_responsible, created_by)
select 'b0000000-0000-0000-0000-000000000001'::uuid, fs.id, true, true, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000a-0000-0000-0000-00000000000a' and fs.client_id = 'b0000000-0000-0000-0000-000000000001'
union all
select 'b0000000-0000-0000-0000-000000000002'::uuid, fs.id, true, true, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000b-0000-0000-0000-00000000000b' and fs.client_id = 'b0000000-0000-0000-0000-000000000002'
union all
select 'b0000000-0000-0000-0000-000000000003'::uuid, fs.id, true, true, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000c-0000-0000-0000-00000000000c' and fs.client_id = 'b0000000-0000-0000-0000-000000000003'
union all
select 'b0000000-0000-0000-0000-000000000003'::uuid, fs.id, true, false, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000d-0000-0000-0000-00000000000d' and fs.client_id = 'b0000000-0000-0000-0000-000000000003'
union all
select 'b0000000-0000-0000-0000-000000000004'::uuid, fs.id, true, true, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000e-0000-0000-0000-00000000000e' and fs.client_id = 'b0000000-0000-0000-0000-000000000004'
union all
select 'b0000000-0000-0000-0000-000000000005'::uuid, fs.id, true, true, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000f-0000-0000-0000-00000000000f' and fs.client_id = 'b0000000-0000-0000-0000-000000000005'
on conflict (client_id, sponsor_id) do nothing;

insert into decision_maker_hierarchy (client_id, sponsor_id, priority, created_by)
select 'b0000000-0000-0000-0000-000000000001'::uuid, fs.id, 1, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000a-0000-0000-0000-00000000000a' and fs.client_id = 'b0000000-0000-0000-0000-000000000001'
union all
select 'b0000000-0000-0000-0000-000000000002'::uuid, fs.id, 1, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000b-0000-0000-0000-00000000000b' and fs.client_id = 'b0000000-0000-0000-0000-000000000002'
union all
select 'b0000000-0000-0000-0000-000000000003'::uuid, fs.id, 1, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000c-0000-0000-0000-00000000000c' and fs.client_id = 'b0000000-0000-0000-0000-000000000003'
union all
select 'b0000000-0000-0000-0000-000000000003'::uuid, fs.id, 2, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000d-0000-0000-0000-00000000000d' and fs.client_id = 'b0000000-0000-0000-0000-000000000003'
union all
select 'b0000000-0000-0000-0000-000000000004'::uuid, fs.id, 1, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000e-0000-0000-0000-00000000000e' and fs.client_id = 'b0000000-0000-0000-0000-000000000004'
union all
select 'b0000000-0000-0000-0000-000000000005'::uuid, fs.id, 1, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000f-0000-0000-0000-00000000000f' and fs.client_id = 'b0000000-0000-0000-0000-000000000005'
on conflict (client_id, sponsor_id) do nothing;

insert into emergency_contact (client_id, full_name, phone, priority, created_by) values
  ('b0000000-0000-0000-0000-000000000001', 'Yaw Asante', '+441234500001', 1, 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'Adjoa Ntim', '+233244000011', 1, 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000003', 'Kojo Serwaa', '+12025550001', 1, 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000003', 'Abena Owusu-Serwaa', '+233244000013', 2, 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000004', 'Nii Adjei', '+233244000014', 1, 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000005', 'Akosua Nyarko', '+16135550001', 1, 'a0000000-0000-0000-0000-000000000001')
on conflict (client_id, priority) do nothing;

-- ── Care plans, consent records, consent grants ─────────────────────────────────────
-- consent_grant (Domain 1: RLS access-control) is what actually lets each primary sponsor
-- read care_plan (clinical detail) — see the Domain 2 migration's design note. The secondary
-- sponsor on client 3 (Abena Owusu-Serwaa) deliberately has NO clinical_detail grant, so the
-- "linked but not consented" case is represented in the seed data too, not just tested ad hoc.

insert into care_plan (id, client_id, summary, effective_from, review_due_at, created_by) values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Daily blood pressure check, medication reminders (amlodipine, metformin), assistance with bathing.', current_date - 30, now() + interval '5 months', 'a0000000-0000-0000-0000-000000000003'),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Post-stroke mobility support, twice-weekly physiotherapy accompaniment, diet monitoring (low sodium).', current_date - 60, now() + interval '4 months', 'a0000000-0000-0000-0000-000000000003'),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'Dementia-informed care routine, fall-risk supervision, family video call assistance twice weekly.', current_date - 90, now() + interval '3 months', 'a0000000-0000-0000-0000-000000000003'),
  ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'Diabetes management, insulin administration supervision, weekly wound dressing.', current_date - 20, now() + interval '5 months', 'a0000000-0000-0000-0000-000000000003'),
  ('e1000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'General companionship and light housekeeping support, medication reminders (aspirin, atorvastatin).', current_date - 45, now() + interval '4 months', 'a0000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into consent_record (id, client_id, document_ref, signed_at, created_by) values
  ('e2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'consents/efua-asante-2026-06-01.pdf', now() - interval '2 months', 'a0000000-0000-0000-0000-000000000001'),
  ('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'consents/kwabena-ntim-2026-05-15.pdf', now() - interval '3 months', 'a0000000-0000-0000-0000-000000000001'),
  ('e2000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'consents/akua-serwaa-2026-04-20.pdf', now() - interval '4 months', 'a0000000-0000-0000-0000-000000000002'),
  ('e2000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'consents/kofi-adjei-2026-06-10.pdf', now() - interval '2 months', 'a0000000-0000-0000-0000-000000000002'),
  ('e2000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'consents/abena-nyarko-2026-05-01.pdf', now() - interval '3 months', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into consent_grant (client_id, grantee_user_id, scope, granted_at, created_by)
values
  ('b0000000-0000-0000-0000-000000000001', 'a000000a-0000-0000-0000-00000000000a', 'clinical_detail', now() - interval '2 months', 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'a000000b-0000-0000-0000-00000000000b', 'clinical_detail', now() - interval '3 months', 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000003', 'a000000c-0000-0000-0000-00000000000c', 'clinical_detail', now() - interval '4 months', 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000004', 'a000000e-0000-0000-0000-00000000000e', 'clinical_detail', now() - interval '2 months', 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000005', 'a000000f-0000-0000-0000-00000000000f', 'clinical_detail', now() - interval '3 months', 'a0000000-0000-0000-0000-000000000001')
on conflict (client_id, grantee_user_id, scope) where revoked_at is null do nothing;

-- ── Providers ────────────────────────────────────────────────────────────────────────

insert into provider (id, user_id, years_experience, created_by) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 8, 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 3, 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000006', 12, 'a0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000007', 5, 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000008', 1, 'a0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000009', 7, 'a0000000-0000-0000-0000-000000000002')
on conflict (user_id) do nothing;

-- Credentials. Deliberately mixed states: nurse1 fully verified, nurse2 mid-onboarding
-- (pending NMC), nurse3 has an EXPIRED NMC PIN/AIN (15 days past expiry — inside the 30-day
-- flagging window the guardrail describes, a realistic case for whenever the credential-expiry
-- cron Edge Function lands), caregiver2 mid-onboarding (pending background check).

insert into credential (id, provider_id, credential_type_id, issuing_authority, status, expiry_date, created_by)
select 'e3000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, id, 'Nursing and Midwifery Council of Ghana', 'verified', (current_date + interval '10 months')::date, 'a0000000-0000-0000-0000-000000000003'::uuid from credential_type where slug = 'nmc_pin_ain'
union all
select 'e3000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, id, 'Ghana Police Service', 'verified', (current_date + interval '10 months')::date, 'a0000000-0000-0000-0000-000000000003'::uuid from credential_type where slug = 'police_report'
union all
select 'e3000000-0000-0000-0000-000000000003'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, id, 'CareBridge CPD Log', 'verified', null, 'a0000000-0000-0000-0000-000000000003'::uuid from credential_type where slug = 'cpd_record'
union all
select 'e3000000-0000-0000-0000-000000000004'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, id, 'Nursing and Midwifery Council of Ghana', 'pending', null, 'a0000000-0000-0000-0000-000000000003'::uuid from credential_type where slug = 'nmc_pin_ain'
union all
select 'e3000000-0000-0000-0000-000000000005'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, id, 'Ghana Police Service', 'verified', (current_date + interval '11 months')::date, 'a0000000-0000-0000-0000-000000000003'::uuid from credential_type where slug = 'police_report'
union all
select 'e3000000-0000-0000-0000-000000000006'::uuid, 'c0000000-0000-0000-0000-000000000003'::uuid, id, 'Nursing and Midwifery Council of Ghana', 'expired', (current_date - interval '15 days')::date, 'a0000000-0000-0000-0000-000000000003'::uuid from credential_type where slug = 'nmc_pin_ain'
union all
select 'e3000000-0000-0000-0000-000000000007'::uuid, 'c0000000-0000-0000-0000-000000000003'::uuid, id, 'Ghana Police Service', 'verified', (current_date + interval '8 months')::date, 'a0000000-0000-0000-0000-000000000003'::uuid from credential_type where slug = 'police_report'
union all
select 'e3000000-0000-0000-0000-000000000008'::uuid, 'c0000000-0000-0000-0000-000000000004'::uuid, id, 'Ghana Police Service', 'verified', (current_date + interval '9 months')::date, 'a0000000-0000-0000-0000-000000000001'::uuid from credential_type where slug = 'police_report'
union all
select 'e3000000-0000-0000-0000-000000000009'::uuid, 'c0000000-0000-0000-0000-000000000004'::uuid, id, 'Former Employer Reference', 'verified', null, 'a0000000-0000-0000-0000-000000000001'::uuid from credential_type where slug = 'reference_check'
union all
select 'e300000a-0000-0000-0000-00000000000a'::uuid, 'c0000000-0000-0000-0000-000000000004'::uuid, id, 'CareBridge CPD Log', 'verified', null, 'a0000000-0000-0000-0000-000000000001'::uuid from credential_type where slug = 'cpd_record'
union all
select 'e300000b-0000-0000-0000-00000000000b'::uuid, 'c0000000-0000-0000-0000-000000000005'::uuid, id, 'Ghana Police Service', 'pending', null, 'a0000000-0000-0000-0000-000000000002'::uuid from credential_type where slug = 'police_report'
union all
select 'e300000c-0000-0000-0000-00000000000c'::uuid, 'c0000000-0000-0000-0000-000000000005'::uuid, id, 'Former Employer Reference', 'verified', null, 'a0000000-0000-0000-0000-000000000002'::uuid from credential_type where slug = 'reference_check'
union all
select 'e300000d-0000-0000-0000-00000000000d'::uuid, 'c0000000-0000-0000-0000-000000000006'::uuid, id, 'Ghana Police Service', 'verified', (current_date + interval '7 months')::date, 'a0000000-0000-0000-0000-000000000002'::uuid from credential_type where slug = 'police_report'
union all
select 'e300000e-0000-0000-0000-00000000000e'::uuid, 'c0000000-0000-0000-0000-000000000006'::uuid, id, 'Former Employer Reference', 'verified', null, 'a0000000-0000-0000-0000-000000000002'::uuid from credential_type where slug = 'reference_check'
union all
select 'e300000f-0000-0000-0000-00000000000f'::uuid, 'c0000000-0000-0000-0000-000000000006'::uuid, id, 'CareBridge CPD Log', 'verified', null, 'a0000000-0000-0000-0000-000000000002'::uuid from credential_type where slug = 'cpd_record'
on conflict (id) do nothing;

insert into credential_verification_event (id, credential_id, outcome, notes, occurred_at, created_by) values
  ('e4000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'verified', 'NMC portal check confirmed active license.', now() - interval '2 months', 'a0000000-0000-0000-0000-000000000003'),
  ('e4000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000006', 'expired', 'License lapsed; scheduling eligibility should be suspended pending renewal (auto-suspend not built yet — see roadmap).', now() - interval '15 days', 'a0000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into identity_verification (id, provider_id, vendor, status, verified_at, created_by) values
  ('e5000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'smile_id', 'verified', now() - interval '2 months', 'a0000000-0000-0000-0000-000000000001'),
  ('e5000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'youverify', 'pending', null, 'a0000000-0000-0000-0000-000000000001'),
  ('e5000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'smile_id', 'verified', now() - interval '6 months', 'a0000000-0000-0000-0000-000000000002'),
  ('e5000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'smile_id', 'verified', now() - interval '3 months', 'a0000000-0000-0000-0000-000000000001'),
  ('e5000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'youverify', 'verified', now() - interval '1 month', 'a0000000-0000-0000-0000-000000000002'),
  ('e5000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000006', 'smile_id', 'verified', now() - interval '4 months', 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into background_check (id, provider_id, status, document_ref, expires_at, created_by) values
  ('e6000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'verified', 'background-checks/adjoa-asante.pdf', current_date + interval '10 months', 'a0000000-0000-0000-0000-000000000001'),
  ('e6000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'verified', 'background-checks/kofi-owusu.pdf', current_date + interval '11 months', 'a0000000-0000-0000-0000-000000000001'),
  ('e6000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'verified', 'background-checks/akosua-darko.pdf', current_date + interval '8 months', 'a0000000-0000-0000-0000-000000000002'),
  ('e6000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'verified', 'background-checks/kwabena-appiah.pdf', current_date + interval '9 months', 'a0000000-0000-0000-0000-000000000001'),
  ('e6000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'pending', 'background-checks/ama-boateng-submitted.pdf', null, 'a0000000-0000-0000-0000-000000000002'),
  ('e6000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000006', 'verified', 'background-checks/yaa-asantewaa.pdf', current_date + interval '7 months', 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into training_record (id, provider_id, title, cpd_points, completed_at, created_by) values
  ('e7000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Wound Care Refresher', 6, now() - interval '1 month', 'a0000000-0000-0000-0000-000000000003'),
  ('e7000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Medication Administration', 4, now() - interval '2 weeks', 'a0000000-0000-0000-0000-000000000003'),
  ('e7000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Palliative Care Basics', 8, now() - interval '3 months', 'a0000000-0000-0000-0000-000000000003'),
  ('e7000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'First Aid & CPR', 5, now() - interval '1 month', 'a0000000-0000-0000-0000-000000000001'),
  ('e7000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000006', 'Dementia Care Essentials', 6, now() - interval '6 weeks', 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

-- verified_profile: manually maintained rollup (Domain 3 migration's design note — no cron
-- auto-computation yet). nmc_licensed is false for every caregiver by construction — they
-- don't hold an NMC PIN/AIN in the first place, not a data-entry gap.
insert into verified_profile (provider_id, id_verified, nmc_licensed, background_checked, training_current, created_by) values
  ('c0000000-0000-0000-0000-000000000001', true, true, true, true, 'a0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000002', false, false, true, true, 'a0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000003', true, false, true, true, 'a0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000004', true, false, true, true, 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000005', true, false, false, false, 'a0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000006', true, false, true, true, 'a0000000-0000-0000-0000-000000000002')
on conflict (provider_id) do nothing;

-- ── Compliance ───────────────────────────────────────────────────────────────────────
-- dpc_registration status is 'pending', matching the real, currently-unresolved "DPC
-- controller registration status" open question in carebridge-roadmap.md — not a placeholder
-- for an 'active' status that doesn't reflect reality yet.

insert into incident_report (id, client_id, provider_id, description, severity, reported_at, created_by) values
  ('e8000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'Minor slip during a bathroom transfer, no injury. Grab bar installation recommended.', 'low', now() - interval '3 weeks', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into dpc_registration (id, registration_number, status, renewal_due_at, created_by) values
  ('e9000000-0000-0000-0000-000000000001', 'DPC-PENDING', 'pending', null, 'a0000000-0000-0000-0000-000000000000')
on conflict (id) do nothing;

-- ── Phase 1 exercise data: employment/referral, roster, visits, escalations, billing ───
-- Everything above (Domain 1-3, 9) covers Phase 0. This block gives a Phase 1 pilot session
-- something to actually click through: a roster assignment, a completed visit with checkin/
-- task/observation, an overdue (not-yet-logged) visit and a future one, two open escalations
-- (one visit-linked, one not), and a subscription/invoice/payment per client so /billing and
-- /dashboard aren't empty. `f`-prefixed UUIDs continue the file's fixed-UUID scheme.

-- provider.employment_status / client.referral_source: UPDATE, not part of the original
-- INSERTs above, so re-running this file after those rows already exist still sets these
-- (an ON CONFLICT DO NOTHING insert would silently skip them on a second run).
update provider set employment_status = 'departed', departed_at = now() - interval '2 weeks',
  departure_reason = 'Relocated to Kumasi' where id = 'c0000000-0000-0000-0000-000000000002';

update client set referral_source = 'existing_family_referral' where id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003');
update client set referral_source = 'social_media' where id = 'b0000000-0000-0000-0000-000000000005';

insert into roster (id, provider_id, zone_id, week_starting, created_by) values
  ('f1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', date_trunc('week', current_date)::date, 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into visit (id, client_id, provider_id, care_plan_id, scheduled_start, scheduled_end, status, created_by) values
  ('f2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'completed', 'a0000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 'scheduled', 'a0000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', now() + interval '2 days', now() + interval '2 days' + interval '1 hour', 'scheduled', 'a0000000-0000-0000-0000-000000000002'),
  ('f2000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004', now() - interval '5 days', now() - interval '5 days' + interval '1 hour', 'completed', 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into visit_checkin (id, visit_id, event, occurred_at, zone_id, created_by) values
  ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'arrived', now() - interval '3 days' + interval '5 minutes', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('f3000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000004', 'arrived', now() - interval '5 days' + interval '5 minutes', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into task (id, visit_id, description, completed, created_by) values
  ('f4000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'Blood pressure check', true, 'a0000000-0000-0000-0000-000000000001'),
  ('f4000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000004', 'Insulin administration supervision', true, 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into observation (id, visit_id, type, value, recorded_at, created_by) values
  ('f5000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'blood_pressure', '128/82, stable', now() - interval '3 days' + interval '20 minutes', 'a0000000-0000-0000-0000-000000000001'),
  ('f5000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000004', 'glucose', '6.2 mmol/L fasting, stable', now() - interval '5 days' + interval '20 minutes', 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into escalation (id, client_id, visit_id, severity, reason, status, created_by) values
  ('f6000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000002', 'medium', 'Visit is overdue and not yet logged — family notified, follow-up required.', 'open', 'a0000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', null, 'critical', 'Family reported unexplained bruising — flagged for clinical director review.', 'open', 'a0000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into subscription (id, client_id, plan_code, currency, amount, billing_interval, status, created_by) values
  ('f7000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'standard_daily', 'GHS', 1200.00, 'monthly', 'active', 'a0000000-0000-0000-0000-000000000001'),
  ('f7000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'standard_daily', 'GHS', 900.00, 'monthly', 'active', 'a0000000-0000-0000-0000-000000000001'),
  ('f7000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'diaspora_premium', 'USD', 450.00, 'monthly', 'active', 'a0000000-0000-0000-0000-000000000002'),
  ('f7000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'standard_daily', 'GHS', 1100.00, 'monthly', 'active', 'a0000000-0000-0000-0000-000000000002'),
  ('f7000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'diaspora_premium', 'GBP', 380.00, 'monthly', 'active', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into invoice (id, client_id, subscription_id, amount, currency, status, due_at, paid_at, created_by) values
  ('f8000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 1200.00, 'GHS', 'paid', current_date - 5, now() - interval '3 days', 'a0000000-0000-0000-0000-000000000001'),
  ('f8000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-000000000003', 450.00, 'USD', 'sent', current_date + 5, null, 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into payment (id, invoice_id, processor, processor_reference, payment_link_url, amount, currency, status, paid_at, created_by) values
  ('f9000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'paystack', 'seed-ref-f8000001', null, 1200.00, 'GHS', 'succeeded', now() - interval '3 days', 'a0000000-0000-0000-0000-000000000001'),
  ('f9000000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000002', 'stripe', 'seed-ref-f8000002', 'https://checkout.stripe.com/pay/seed-demo-not-real', 450.00, 'USD', 'pending', null, 'a0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;
