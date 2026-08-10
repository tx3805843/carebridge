# Family Authority Grants (Increment B0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `client_relationship.is_decision_maker`/`is_billing_responsible` with a
polymorphic `authority_grant` table, cut over every reader (RLS, two payment webhooks, the
WhatsApp notifier, the onboarding RPC), and drop `client_relationship`, with zero data loss
and zero regression to live billing access control.

**Architecture:** One supervisor-tier migration (schema + RLS + backfill + function
rewrites + drop, in that order, one transaction) followed by cutover edits to four
TypeScript call sites, a seed-data rewrite, a type regen, and an ADR. This project has no
SQL unit-test framework — every prior migration in this repo is verified by
`supabase db reset` + `pnpm --filter @carebridge/db rls:check` (static CLAUDE.md-guardrail
check) + direct role-impersonation SQL against a real local Postgres, driven by the actual
app where relevant. This plan follows that same pattern rather than inventing a test
framework this codebase doesn't have.

**Tech Stack:** Supabase CLI (local Postgres via `supabase db reset`), plain SQL migrations,
Supabase JS client (`@supabase/supabase-js` v2) in Next.js server actions and Deno Edge
Functions, `pnpm --filter` workspace scripts.

**Spec:** `docs/superpowers/specs/2026-08-10-family-authority-grants-design.md`

---

### Task 1: Write the migration

**Files:**
- Create: `supabase/migrations/20260810070000_family_authority_grants.sql`

- [ ] **Step 1: Write the complete migration file**

```sql
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
-- client_relationship for base linkage (public.is_linked_sponsor(), used by client/care_plan
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
```

- [ ] **Step 2: No local Postgres running yet — nothing to run this step against.** Proceed
  to Task 2, which starts the local stack and applies this file.

---

### Task 2: Apply and verify the migration locally

**Files:** none (verification only)

- [ ] **Step 1: Start the local Supabase stack**

Run: `supabase start`
Expected: prints `API_URL`, `DB_URL`, etc. (if already running, `supabase status` instead —
either way you need the local stack up for the next step).

- [ ] **Step 2: Reset the local database to apply every migration including the new one**

Run: `supabase db reset`
Expected: the last two lines of migration output are:
```
Applying migration 20260810060000_escalation_governed_resolution.sql...
Applying migration 20260810070000_family_authority_grants.sql...
Seeding data from supabase/seed.sql...
```
If this fails, the error names the exact SQL statement — fix Task 1's file and re-run. Do
not proceed until this is clean, since `seed.sql` still references the old
`client_relationship` table until Task 5 rewrites it — **expect this specific reset to fail
on the seed step** (`relation "client_relationship" does not exist`), which confirms the
migration itself applied correctly. That failure is expected here and resolved by Task 5;
do not treat it as a migration bug.

- [ ] **Step 3: Run the RLS-coverage static check**

Run: `pnpm --filter @carebridge/db rls:check`
Expected: exits 0, no output naming `authority_grant` as missing a policy or audit column.
This is the closest thing this repo has to an automated test for the CLAUDE.md guardrail
("every table has an explicit RLS policy") — treat a failure here the same as a failing
test: fix Task 1's file, don't skip.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260810070000_family_authority_grants.sql
git commit -m "Increment B0: add authority_grant table, cut over billing RLS and onboarding RPC off client_relationship"
```

---

### Task 3: Rewrite seed.sql off authority_grant

**Files:**
- Modify: `supabase/seed.sql:71-93`

- [ ] **Step 1: Replace the client_relationship insert block**

Find this exact block (lines 71-93):

```sql
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
```

Replace it with (note: sponsor `a000000d` — the granddaughter on client 3 — deliberately gets
**only** `decision_maker`, no `billing_responsible`, preserving the exact same "linked,
decision-maker, but not billing-responsible" seed scenario the original data encoded):

```sql
-- Literal uuid columns are cast explicitly (::uuid) in every branch below: Postgres resolves
-- an untyped string constant across a UNION ALL to `text`, and text -> uuid is not an
-- implicit/assignment cast for an INSERT ... SELECT (unlike a plain INSERT ... VALUES, where
-- the target column type drives the cast directly).
insert into authority_grant (client_id, sponsor_id, authority_type, status, granted_at, granted_by, created_by)
select 'b0000000-0000-0000-0000-000000000001'::uuid, fs.id, 'decision_maker', 'active', now(), 'a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000a-0000-0000-0000-00000000000a' and fs.client_id = 'b0000000-0000-0000-0000-000000000001'
union all
select 'b0000000-0000-0000-0000-000000000002'::uuid, fs.id, 'decision_maker', 'active', now(), 'a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000b-0000-0000-0000-00000000000b' and fs.client_id = 'b0000000-0000-0000-0000-000000000002'
union all
select 'b0000000-0000-0000-0000-000000000003'::uuid, fs.id, 'decision_maker', 'active', now(), 'a0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000c-0000-0000-0000-00000000000c' and fs.client_id = 'b0000000-0000-0000-0000-000000000003'
union all
select 'b0000000-0000-0000-0000-000000000003'::uuid, fs.id, 'decision_maker', 'active', now(), 'a0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000d-0000-0000-0000-00000000000d' and fs.client_id = 'b0000000-0000-0000-0000-000000000003'
union all
select 'b0000000-0000-0000-0000-000000000004'::uuid, fs.id, 'decision_maker', 'active', now(), 'a0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000e-0000-0000-0000-00000000000e' and fs.client_id = 'b0000000-0000-0000-0000-000000000004'
union all
select 'b0000000-0000-0000-0000-000000000005'::uuid, fs.id, 'decision_maker', 'active', now(), 'a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000f-0000-0000-0000-00000000000f' and fs.client_id = 'b0000000-0000-0000-0000-000000000005'
on conflict (client_id, sponsor_id, authority_type) where status = 'active' do nothing;

insert into authority_grant (client_id, sponsor_id, authority_type, status, granted_at, granted_by, created_by)
select 'b0000000-0000-0000-0000-000000000001'::uuid, fs.id, 'billing_responsible', 'active', now(), 'a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000a-0000-0000-0000-00000000000a' and fs.client_id = 'b0000000-0000-0000-0000-000000000001'
union all
select 'b0000000-0000-0000-0000-000000000002'::uuid, fs.id, 'billing_responsible', 'active', now(), 'a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000b-0000-0000-0000-00000000000b' and fs.client_id = 'b0000000-0000-0000-0000-000000000002'
union all
select 'b0000000-0000-0000-0000-000000000003'::uuid, fs.id, 'billing_responsible', 'active', now(), 'a0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000c-0000-0000-0000-00000000000c' and fs.client_id = 'b0000000-0000-0000-0000-000000000003'
union all
select 'b0000000-0000-0000-0000-000000000004'::uuid, fs.id, 'billing_responsible', 'active', now(), 'a0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid
from family_sponsor fs where fs.user_id = 'a000000e-0000-0000-0000-00000000000e' and fs.client_id = 'b0000000-0000-0000-0000-000000000004'
union all
select 'b0000000-0000-0000-0000-000000000005'::uuid, fs.id, 'billing_responsible', 'active', now(), 'a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid
from family_sponsor fs where fs.user_id = 'a000000f-0000-0000-0000-00000000000f' and fs.client_id = 'b0000000-0000-0000-0000-000000000005'
on conflict (client_id, sponsor_id, authority_type) where status = 'active' do nothing;
```

- [ ] **Step 2: Reset and confirm the seed applies cleanly now**

Run: `supabase db reset`
Expected: completes with `Finished supabase db reset on branch main.` and no error — this
time the seed step must succeed (Task 2 Step 2's expected failure is now resolved).

- [ ] **Step 3: Spot-check row counts directly against Postgres**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "select authority_type, status, count(*) from authority_grant group by 1, 2 order by 1, 2;"
```
Expected output: `billing_responsible | active | 5` and `decision_maker | active | 6` — matching
the original 6 `is_decision_maker=true` rows and 5 `is_billing_responsible=true` rows (the
granddaughter on client 3 excluded from billing, as in the original seed).

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.sql
git commit -m "Increment B0: seed authority_grant instead of client_relationship"
```

---

### Task 4: Role-impersonation verification of RLS and billing access control

This is the equivalent of an integration test suite for this codebase — every prior
migration in this repo was verified this way, not with a unit-test framework. Run each
query below via `psql` against the local database (same connection string as Task 3 Step 3).
`set local role authenticated; set local request.jwt.claims = '{"sub": "<user-id>"}';`
simulates a specific authenticated user for RLS purposes, matching the pattern used
throughout this project's migration verification.

**`set local` only lasts for the current transaction** — every step below MUST be wrapped in
an explicit `begin; ... commit;` (or `rollback;` for Step 5, since it's a rejected-write
test) so the `set local` statements and the query that depends on them run in the same
transaction. Sending them as separate autocommit statements (e.g. a bare `psql <<SQL` heredoc
with no `begin`/`commit`) silently drops the `set local` before the query runs and produces
wrong results (confirmed: this exact failure mode was hit and diagnosed during this plan's
own execution) — the query blocks below already include the wrapper; don't strip it out when
reusing this pattern for a future migration.

**Files:** none (verification only)

- [ ] **Step 1: Confirm the billing-responsible sponsor sees their own invoice**

`a000000a` (Yaw Asante) is `billing_responsible` for client `b...0001` (Efua Asante) per the
seed. Run:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a000000a-0000-0000-0000-00000000000a"}';
select internal.is_billing_responsible_sponsor('b0000000-0000-0000-0000-000000000001');
commit;
SQL
```
Expected: `t` (true).

- [ ] **Step 2: Confirm a non-billing-responsible linked sponsor does NOT see billing**

`a000000d` (Abena Owusu-Serwaa, the granddaughter) is `decision_maker` but explicitly not
`billing_responsible` for client `b...0003`. Run:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a000000d-0000-0000-0000-00000000000d"}';
select internal.is_billing_responsible_sponsor('b0000000-0000-0000-0000-000000000003');
commit;
SQL
```
Expected: `f` (false). This is the exact scenario the design doc's "financial-access-control"
risk note called out — confirm it holds, don't assume it from the SQL alone.

- [ ] **Step 3: Confirm a staff user can see all authority_grant rows**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000001"}';
select count(*) from authority_grant;
commit;
SQL
```
Expected: `11` (6 decision_maker + 5 billing_responsible from Task 3 Step 3).

- [ ] **Step 4: Confirm an unrelated sponsor sees zero authority_grant rows**

`a000000a` (Yaw Asante, sponsor for client 1 only) queried against client 3's rows:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a000000a-0000-0000-0000-00000000000a"}';
select count(*) from authority_grant where client_id = 'b0000000-0000-0000-0000-000000000003';
commit;
SQL
```
Expected: `0`.

- [ ] **Step 5: Confirm a direct bystander INSERT is rejected**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a000000a-0000-0000-0000-00000000000a"}';
insert into authority_grant (client_id, sponsor_id, authority_type)
select 'b0000000-0000-0000-0000-000000000003'::uuid, fs.id, 'billing_responsible'
from family_sponsor fs where fs.user_id = 'a000000a-0000-0000-0000-00000000000a' limit 1;
rollback;
SQL
```
Expected: `ERROR: new row violates row-level security policy for table "authority_grant"` (a
non-staff sponsor cannot write, only staff can — `authority_grant_write_staff`).

No code changes in this task — if any step's actual output doesn't match expected, stop and
fix Task 1's migration before continuing to Task 5.

---

### Task 5: Cut over the four TypeScript/Deno call sites

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts:89-94`
- Modify: `supabase/functions/paystack-webhook/index.ts:70-75`
- Modify: `apps/ops-console/lib/whatsapp.ts:92-102`
- Modify: `apps/ops-console/app/billing/[id]/actions.ts:46-53`

- [ ] **Step 1: `supabase/functions/stripe-webhook/index.ts`**

Find:
```typescript
async function notifyBillingResponsibleSponsors(supabase: ReturnType<typeof createClient>, clientId: string) {
  const { data: relationships } = await supabase
    .from("client_relationship")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("is_billing_responsible", true);
```
Replace with:
```typescript
async function notifyBillingResponsibleSponsors(supabase: ReturnType<typeof createClient>, clientId: string) {
  const { data: relationships } = await supabase
    .from("authority_grant")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("authority_type", "billing_responsible")
    .eq("status", "active");
```

- [ ] **Step 2: `supabase/functions/paystack-webhook/index.ts`**

Find:
```typescript
async function notifyBillingResponsibleSponsors(supabase: ReturnType<typeof createClient>, clientId: string) {
  const { data: relationships } = await supabase
    .from("client_relationship")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("is_billing_responsible", true);
```
Replace with:
```typescript
async function notifyBillingResponsibleSponsors(supabase: ReturnType<typeof createClient>, clientId: string) {
  const { data: relationships } = await supabase
    .from("authority_grant")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("authority_type", "billing_responsible")
    .eq("status", "active");
```

- [ ] **Step 3: `apps/ops-console/lib/whatsapp.ts`**

Find:
```typescript
/**
 * Notifies every billing-responsible sponsor for a client — deliberately narrower than
 * notifyVisitComplete's "every linked sponsor": invoice/payment visibility is gated the same
 * way in RLS (client_relationship.is_billing_responsible), not just family_sponsor linkage.
 */
async function billingResponsibleSponsorUsers(supabase: SupabaseClient<Database>, clientId: string) {
  const { data: relationships } = await supabase
    .from("client_relationship")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("is_billing_responsible", true);
```
Replace with:
```typescript
/**
 * Notifies every billing-responsible sponsor for a client — deliberately narrower than
 * notifyVisitComplete's "every linked sponsor": invoice/payment visibility is gated the same
 * way in RLS (authority_grant, authority_type='billing_responsible'), not just family_sponsor
 * linkage.
 */
async function billingResponsibleSponsorUsers(supabase: SupabaseClient<Database>, clientId: string) {
  const { data: relationships } = await supabase
    .from("authority_grant")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("authority_type", "billing_responsible")
    .eq("status", "active");
```

- [ ] **Step 4: `apps/ops-console/app/billing/[id]/actions.ts`**

Find:
```typescript
  // Billing-responsible sponsor's email is required by Paystack's initialize-transaction API;
  // if none is on file yet, we still record the invoice + a linkless pending payment rather
  // than blocking invoice creation on it — staff can add the payment link manually later.
  const { data: billingRelationships } = await supabase
    .from("client_relationship")
    .select("sponsor_id")
    .eq("client_id", subscription.client_id)
    .eq("is_billing_responsible", true);
```
Replace with:
```typescript
  // Billing-responsible sponsor's email is required by Paystack's initialize-transaction API;
  // if none is on file yet, we still record the invoice + a linkless pending payment rather
  // than blocking invoice creation on it — staff can add the payment link manually later.
  const { data: billingRelationships } = await supabase
    .from("authority_grant")
    .select("sponsor_id")
    .eq("client_id", subscription.client_id)
    .eq("authority_type", "billing_responsible")
    .eq("status", "active");
```

Note: the variable name `billingRelationships` is left as-is deliberately — renaming it isn't
required by this change and touching more of the file than necessary raises review risk for
no benefit.

- [ ] **Step 5: Confirm no stray `client_relationship` table reference remains in application code**

Run:
```bash
grep -rn "client_relationship" apps/ops-console supabase/functions --include="*.ts" --include="*.tsx" \
  | grep -v node_modules
```
Expected: no output — every table reference is gone.

- [ ] **Step 6: Confirm `is_billing_responsible`/`is_decision_maker` only remain where they're
  supposed to — as RPC payload key names, not table/column references**

Run:
```bash
grep -rn "is_billing_responsible\|is_decision_maker" apps/ops-console supabase/functions \
  --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Expected: exactly two lines, both in `apps/ops-console/app/clients/new/actions.ts` —
`is_decision_maker: sponsor.isDecisionMaker,` and
`is_billing_responsible: sponsor.isBillingResponsible,` (around line 114-115). These are
correct and unchanged: `onboard_client_with_care_team`'s `p_sponsors` jsonb *parameter shape*
is deliberately unchanged (Task 1) — only the function body now writes `authority_grant`
instead of `client_relationship`. If any other file appears in this output, something was
missed — go back and fix it before continuing.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts supabase/functions/paystack-webhook/index.ts \
  apps/ops-console/lib/whatsapp.ts "apps/ops-console/app/billing/[id]/actions.ts"
git commit -m "Increment B0: cut billing webhooks/notifier/actions over to authority_grant"
```

---

### Task 6: Regenerate types and update the domain module

**Files:**
- Modify: `packages/domain/src/generated.ts` (regenerated, not hand-edited)
- Modify: `packages/domain/src/identity.ts`

- [ ] **Step 1: Regenerate generated.ts from the local schema**

Run: `pnpm --filter @carebridge/db types:generate`
Expected: `packages/domain/src/generated.ts` is rewritten; `git diff --stat
packages/domain/src/generated.ts` shows changes (client_relationship's `Tables` entry gone,
`authority_grant` present).

- [ ] **Step 2: Update `packages/domain/src/identity.ts`**

Find:
```typescript
export type ClientRelationship = Database["public"]["Tables"]["client_relationship"]["Row"];
export type ClientRelationshipInsert = Database["public"]["Tables"]["client_relationship"]["Insert"];
```
Replace with:
```typescript
export type AuthorityGrant = Database["public"]["Tables"]["authority_grant"]["Row"];
export type AuthorityGrantInsert = Database["public"]["Tables"]["authority_grant"]["Insert"];
```

- [ ] **Step 3: Confirm nothing else imports the removed types**

Run: `grep -rln "ClientRelationship" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v generated.ts`
Expected: no output (confirmed already in the plan's research phase — this step re-confirms
after the actual edit).

- [ ] **Step 4: Typecheck the domain package**

Run: `pnpm --filter @carebridge/domain typecheck`
Expected: exits 0. If `@carebridge/domain` has no `typecheck` script, run
`pnpm --filter ops-console typecheck` instead (Task 7 does this anyway, but confirming here
isolates whether a failure is domain-module-specific or app-specific).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/generated.ts packages/domain/src/identity.ts
git commit -m "Increment B0: regenerate types, retire ClientRelationship for AuthorityGrant"
```

---

### Task 7: Typecheck and lint the app

**Files:** none (verification only)

- [ ] **Step 1: Typecheck ops-console**

Run: `pnpm --filter ops-console typecheck`
Expected: exits 0, no errors referencing `client_relationship`, `is_billing_responsible`, or
`ClientRelationship`.

- [ ] **Step 2: Lint ops-console**

Run: `pnpm --filter ops-console lint`
Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 3: If either fails**, the error output names the exact file/line — fix it in
  the relevant task above (don't patch ad hoc here) and re-run both commands.

---

### Task 8: Update docs — domain model and ADR-0005

**Files:**
- Modify: `docs/domain-model.md:11`
- Create: `docs/adr/0005-family-authority-grants-not-relationship-booleans.md`

- [ ] **Step 1: Update the Domain 1 row in `docs/domain-model.md`**

Find:
```
| 1 | Identity & Access | `user`, `role`, `family_sponsor`, `client_relationship`, `consent_grant` | `identity.ts` |
```
Replace with:
```
| 1 | Identity & Access | `user`, `role`, `family_sponsor`, `authority_grant`, `consent_grant` | `identity.ts` |
```

- [ ] **Step 2: Write `docs/adr/0005-family-authority-grants-not-relationship-booleans.md`**

```markdown
# ADR-0005: Family authority grants replace client_relationship booleans

**Status:** Accepted
**Date:** 2026-08-10

## Context

`client_relationship.is_decision_maker`/`is_billing_responsible` conflated two different
kinds of fact: "this person is family" (a `family_sponsor` link, which already exists
independently) and "this person has a specific real-world authority" (decides on care, pays
the bill). The UX review that scoped this work (`docs/user-guide/ux-refresh/
carebridge-ops-ux-review.md`) states this directly: "Do not merge family relationship with
authority. Relationship, payer responsibility, care-decision authority, health-update
authority, escort authority, and emergency-contact authority remain separate."

`is_billing_responsible` is not a cosmetic flag — it drives `internal.
is_billing_responsible_sponsor()`, which gates real `subscription`/`invoice`/`payment` RLS
policies, and is queried directly by the Stripe and Paystack webhook Edge Functions and the
WhatsApp billing notifier. Any redesign here is financial-access-control work, not UI
polish (CLAUDE.md: "Financial logic... is supervisor-tier").

A `consent_grant` table already exists (Domain 1) as the CLAUDE.md-mandated mechanism for
gating *read access* to clinical/sensitive data (`clinical_detail`, `billing`,
`location_tracking`, `photos` scopes) — it already gates `care_plan` reads for family
sponsors. Decision-maker/billing-responsible/escort authority is a different kind of fact
(who is responsible/allowed to act, not who may read what), so extending `consent_grant`
with new scopes for these would conflate two distinct mechanisms.

## Decision

Add a new polymorphic table, `authority_grant` (`client_id`, `sponsor_id`, `authority_type`
∈ {`decision_maker`, `billing_responsible`, `escort`}, `status` ∈ {`pending`, `active`,
`revoked`, `rejected`}, evidence reference, effective period, granted/revoked
actor+timestamp) — same shape convention as `consent_grant`/`credential` (`text` + `check`,
not an enum, so a new authority type is a plain migration). `consent_grant` and
`emergency_contact` are unchanged: health-update/photography authority stay `consent_grant`
scopes; emergency-contact stays the existing free-standing `emergency_contact` table, which
was never derived from sponsor linkage and already satisfies the "don't merge relationship
with authority" rule.

`client_relationship` is dropped, not kept as a bare link table: once the two booleans move
out it carries zero data `family_sponsor` doesn't already provide (`family_sponsor` already
uniquely links `(user_id, client_id)` with a `relationship` label, and
`client_relationship.sponsor_id` already implies `client_id` through that same row). No RLS
policy elsewhere keyed off `client_relationship` for base linkage. Existing rows are
backfilled into `authority_grant` before the drop.

Full cutover in one migration, no compatibility shim: `internal.
is_billing_responsible_sponsor()`, both payment webhooks, the WhatsApp notifier, the
invoice-creation action, and the transactional-onboarding RPC are all rewritten in the same
change to read `authority_grant` — two mechanisms answering "who is billing-responsible"
during a transition window was rejected as a drift risk in a real financial-access-control
path.

## Consequences

- Onboarding UI (Increment B1), the Consent & Authority step (B2), and activation-gate
  enforcement (B3) can build against `authority_grant`'s `pending`/`active`/`revoked`/
  `rejected` lifecycle — this migration doesn't build that review workflow itself, but
  leaves the schema ready for it.
- A future authority type (e.g. escort's evidence requirements turning out to need a
  different shape) is a plain migration adding a new `authority_type` check value, not a
  new table or an `ALTER TYPE`.
- Rejected: extending `consent_grant` with new scopes for decision-maker/billing-
  responsible/escort — conflates "may read this data" with "is responsible for this,"
  and decision-maker/emergency-contact were deliberately modeled as *not* requiring a
  consent grant in the first place (Domain 2 migration's own design note).
- Rejected: keeping `client_relationship` as an empty link table after the split — no
  unique data survives; would be a table that exists only to preserve its own name.
```

- [ ] **Step 3: Commit**

```bash
git add docs/domain-model.md docs/adr/0005-family-authority-grants-not-relationship-booleans.md
git commit -m "Increment B0: update domain-model.md, add ADR-0005"
```

---

### Task 9: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Mark Increment B0 done in the checklist**

Find the `- [ ] Increment B0 (...)` line (added in the prior session, describing the planned
work). Mark it `- [x]` and append a summary in the same inline style used by A0/A/A cont'd
above it: what got built (table + RLS + backfill + full cutover of every reader),
confirmation the migration applied clean locally (Task 2), RLS/financial-access-control
verified via role impersonation (Task 4 — name the specific scenario: billing-responsible
sponsor sees billing, non-billing-responsible linked sponsor does not), typecheck/lint clean
(Task 7), ADR-0005 written, seed data preserves the original test scenarios (Task 3), not
pushed/committed-to-remote unless separately asked.

- [ ] **Step 2: Update the top status line**

Update the `Last updated:` line to note Increment B0 is done and Increment B1 (onboarding UI
as a 6-step draft workflow) is next.

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment B0, next up Increment B1"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** every numbered decision in the design spec has a corresponding task —
  table shape (Task 1), RLS (Task 1 + Task 4), backfill (Task 1 + Task 2), function rewrites
  (Task 1), full cutover of all listed call sites (Task 5), `consent_grant`/
  `emergency_contact` left untouched (no task touches them — verified by the `grep` in Task
  5 Step 5 finding no remaining references), ADR (Task 8).
- **Not covered by this plan, by design (see spec's Non-goals):** B1/B2/B3 UI work,
  `consent_grant` schema retrofit. Do not add these — they're separate roadmap items.
- **Local-only:** this plan does not push migrations to hosted `carebridge` or commit/push
  to `origin` beyond local commits — those are the user's call per this project's working
  agreement, ask before either.
