# Client Activation Status (Increment B3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `client` a real `status` lifecycle for the first time (`active`/`inactive`),
back it with a database trigger that refuses to set `status = 'active'` unless the client
already has ≥1 emergency contact, ≥1 care plan, and ≥1 active authority grant, wire the
onboarding RPC's last statement to flip a newly-onboarded client active, and add a manual
deactivate/reactivate action on `/clients/[id]` plus a scheduling guard on `/visits/new`.

**Architecture:** One supervisor-tier migration (new column + invariant-check function +
trigger + RPC rewrite, in that order, one transaction), then three small worker-tier app
edits (client detail page, its server actions, the visit-scheduling server action). This
project has no SQL unit-test framework — every prior migration is verified by
`supabase db reset` + `pnpm --filter @carebridge/db rls:check` + direct role-impersonation
SQL against a real local Postgres, driven through the actual app where relevant. This plan
follows that same pattern.

**Tech Stack:** Supabase CLI (local Postgres via `supabase db reset`), plain SQL migrations,
Supabase JS client (`@supabase/supabase-js` v2) in Next.js server actions, `pnpm --filter`
workspace scripts.

**Spec:** `docs/superpowers/specs/2026-08-10-client-activation-b3-design.md`

---

### Task 1: Write the migration

**Files:**
- Create: `supabase/migrations/20260810080000_client_activation_status.sql`

- [ ] **Step 1: Write the complete migration file**

```sql
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
```

- [ ] **Step 2: Confirm the migration filename sorts after the last existing migration**

Run: `ls supabase/migrations | sort | tail -3`
Expected: `20260810080000_client_activation_status.sql` is the last line.

---

### Task 2: Apply and verify the migration locally

**Files:** none (verification only)

- [ ] **Step 1: Reset the local database**

Run: `supabase db reset`
Expected: all migrations apply cleanly, including the new one, with no errors.

- [ ] **Step 2: Run the RLS-coverage check**

Run: `pnpm --filter @carebridge/db rls:check`
Expected: passes, table count unchanged from before this migration (this migration adds no
new table — `client` already had `created_at`/`updated_at`/`created_by`/RLS from Domain 2).

- [ ] **Step 3: Confirm the column and trigger exist**

Run:
```bash
supabase db psql -c "\d client" 2>/dev/null | grep -A2 status
supabase db psql -c "select tgname from pg_trigger where tgrelid = 'client'::regclass and not tgisinternal;"
```
(If `supabase db psql` isn't available in this CLI version, use `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)"` instead, or connect via the connection string printed by `supabase status`.)

Expected: `status` column present, `client_enforce_activation_ready` listed among the
triggers.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260810080000_client_activation_status.sql
git commit -m "B3: add client.status + trigger-enforced activation invariant"
```

---

### Task 3: Role-impersonation verification of the invariant

**Files:** none (verification only, via SQL against the local Postgres instance)

This is the supervisor-tier part of the increment — the invariant gates real client
activation, so it gets verified directly against Postgres, not just exercised through the
app. Same connection string and `begin; set local role authenticated; set local
request.jwt.claims = '{"sub": "<user-id>"}'; ...; commit;` wrapper this repo's migrations are
always verified with (see `docs/superpowers/plans/2026-08-10-family-authority-grants.md`
Task 4) — `set local` only lasts the current transaction, so every step below must stay
wrapped in its own `begin`/`commit`. Impersonating `a0000000-0000-0000-0000-000000000001`
(`coordinator1@carebridge.dev`, seeded staff) throughout, since `client_write_staff` only
allows staff to write `client` at all.

- [ ] **Step 1: Confirm the trigger rejects activating an under-qualified client**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000001"}';
insert into client (full_name, date_of_birth, address, zone_id, created_by)
values ('B3 Trigger Test Client', '1950-01-01', 'Test address', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')
returning id;
commit;
SQL
```

Note the returned `id` as `TEST_CLIENT_ID` (export it, e.g. `export TEST_CLIENT_ID=<value>`,
since later steps interpolate it into new heredocs via `$TEST_CLIENT_ID` — each `psql <<SQL`
call below is a fresh connection, so state only carries over via an explicit `commit` in the
step that creates it, which is why this insert commits immediately rather than staying open
for the next step). Then:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000001"}';
update client set status = 'active' where id = '$TEST_CLIENT_ID';
rollback;
SQL
```

Expected: the `update` fails with `ERROR:  Client <id> cannot be activated: requires at least
one emergency contact, one care plan, and one active authority grant`; the trailing `rollback`
then completes cleanly against the now-aborted transaction (same "expected failure, explicit
rollback" shape as `docs/superpowers/plans/2026-08-10-family-authority-grants.md` Task 4 Step
5). Confirm the row is still `inactive` in a fresh query:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select status from client where id = '$TEST_CLIENT_ID';"
```

Expected: `inactive`.

- [ ] **Step 2: Confirm the trigger accepts a fully-qualified client**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000001"}';

insert into emergency_contact (client_id, full_name, phone, priority, created_by)
values ('$TEST_CLIENT_ID', 'Test Contact', '+233200000000', 1, 'a0000000-0000-0000-0000-000000000001');

insert into care_plan (client_id, summary, created_by)
values ('$TEST_CLIENT_ID', 'Test care plan summary', 'a0000000-0000-0000-0000-000000000001');

insert into family_sponsor (user_id, client_id, relationship, created_by)
values ('a000000a-0000-0000-0000-00000000000a', '$TEST_CLIENT_ID', 'tester', 'a0000000-0000-0000-0000-000000000001')
returning id;
commit;
SQL
```

Note the returned `id` as `TEST_SPONSOR_ID` (export it, same reason as `TEST_CLIENT_ID` above
— reusing seeded sponsor user `a000000a-0000-0000-0000-00000000000a`, Yaw Asante, linked here
to a second client, which is allowed since `family_sponsor` has no one-client-per-user
constraint). Then:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000001"}';

insert into authority_grant (client_id, sponsor_id, authority_type, status, granted_at, granted_by, created_by)
values ('$TEST_CLIENT_ID', '$TEST_SPONSOR_ID', 'decision_maker', 'active', now(), 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');

update client set status = 'active' where id = '$TEST_CLIENT_ID';
select status from client where id = '$TEST_CLIENT_ID';
commit;
SQL
```

Expected: the `update` succeeds, the final `select` reads `active`.

- [ ] **Step 3: Clean up the test rows and reset to clean seed state**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-0000-0000-000000000001"}';
delete from authority_grant where client_id = '$TEST_CLIENT_ID';
delete from family_sponsor where id = '$TEST_SPONSOR_ID';
delete from care_plan where client_id = '$TEST_CLIENT_ID';
delete from emergency_contact where client_id = '$TEST_CLIENT_ID';
delete from client where id = '$TEST_CLIENT_ID';
commit;
SQL
```

Then run: `supabase db reset` (returns to clean seed state for the next task — the explicit
deletes above are belt-and-suspenders, `db reset` is what actually guarantees clean state).

---

### Task 4: Regenerate types

**Files:**
- Modify: `packages/domain/src/generated.ts` (auto-generated, not hand-edited)

- [ ] **Step 1: Ensure the local Supabase stack is running**

Run: `supabase status`
Expected: shows `API URL`/`DB URL` as running. If stopped, run `supabase start` first.

- [ ] **Step 2: Regenerate types**

Run: `pnpm --filter @carebridge/db types:generate`
Expected: completes with no error; `git diff packages/domain/src/generated.ts` shows a new
`status: string` field (and its `Insert`/`Update` variants) on the `client` table's type, plus
the two new function signatures (`check_client_activation_ready`,
`enforce_client_activation_ready` — the latter may not appear since trigger functions
returning `trigger` aren't typically exposed as RPC-callable types; that's expected, not a
bug).

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/generated.ts
git commit -m "B3: regenerate types for client.status"
```

---

### Task 5: Client detail page — status badge and deactivate/reactivate actions

**Files:**
- Modify: `apps/ops-console/app/clients/[id]/actions.ts`
- Modify: `apps/ops-console/app/clients/[id]/page.tsx`

- [ ] **Step 1: Add the two server actions**

In `apps/ops-console/app/clients/[id]/actions.ts`, add after the existing `recordConsent`
function (after line 158, the file's current last line):

```ts

export async function deactivateClient(clientId: string, _formData: FormData) {
  await requireStaffUser();
  const supabase = await createClient();

  const { error } = await supabase.from("client").update({ status: "inactive" }).eq("id", clientId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=status`);
}

export async function reactivateClient(clientId: string, _formData: FormData) {
  await requireStaffUser();
  const supabase = await createClient();

  const { error } = await supabase.from("client").update({ status: "active" }).eq("id", clientId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=status`);
}
```

These match this file's existing `grantAuthority`/`revokeAuthority` shape exactly:
`requireStaffUser()` first, redirect-with-`?error=` on failure (this is also where the
trigger's `raise exception` message surfaces — Postgres error text flows through
`error.message` the same way an RLS rejection already does for every other action in this
file), redirect-with-`?updated=` on success. `_formData` is unused but required — this
function is bound via `.bind(null, clientId)` into a `<form action={...}>`, and Next.js server
actions used as form actions are always called with the submitted `FormData` as the final
argument, matching `apps/ops-console/app/billing/[id]/actions.ts#generateInvoice`'s identical
`(subscriptionId: string, _formData: FormData)` signature.

- [ ] **Step 2: Import the two new actions and add `status` to the page's `client` query**

In `apps/ops-console/app/clients/[id]/page.tsx`, change line 7 from:

```ts
import { grantAuthority, revokeAuthority, grantConsent, revokeConsent, recordConsent } from "./actions";
```

to:

```ts
import {
  grantAuthority,
  revokeAuthority,
  grantConsent,
  revokeConsent,
  recordConsent,
  deactivateClient,
  reactivateClient,
} from "./actions";
```

Change lines 29-33 from:

```ts
  const { data: client } = await supabase
    .from("client")
    .select("id, full_name, date_of_birth, zone_id")
    .eq("id", id)
    .maybeSingle();
```

to:

```ts
  const { data: client } = await supabase
    .from("client")
    .select("id, full_name, date_of_birth, zone_id, status")
    .eq("id", id)
    .maybeSingle();
```

- [ ] **Step 3: Add the status badge and the deactivate/reactivate action**

Change lines 72-76 (the `EntitySummaryCard` call) from:

```tsx
      <EntitySummaryCard
        title={client.full_name}
        subtitle={zone?.name ?? "No zone"}
        meta={[{ label: "DOB", value: formatDate(client.date_of_birth) }]}
      />
```

to:

```tsx
      <EntitySummaryCard
        title={client.full_name}
        subtitle={zone?.name ?? "No zone"}
        meta={[
          { label: "DOB", value: formatDate(client.date_of_birth) },
          {
            label: "Status",
            value: (
              <StatusBadge
                variant={client.status === "active" ? "success" : "neutral"}
                label={client.status === "active" ? "Active" : "Inactive"}
              />
            ),
          },
        ]}
        actions={
          <form action={(client.status === "active" ? deactivateClient : reactivateClient).bind(null, client.id)}>
            <ConfirmSubmitButton
              size="sm"
              variant={client.status === "active" ? "destructive" : "outline"}
              confirmTitle={client.status === "active" ? "Deactivate client" : "Reactivate client"}
              confirmDescription={
                client.status === "active" ? (
                  <>
                    Deactivating <strong>{client.full_name}</strong> stops new visits from being scheduled for
                    them. This can be undone by reactivating.
                  </>
                ) : (
                  <>
                    Reactivating <strong>{client.full_name}</strong> re-checks that they still have an emergency
                    contact, a care plan, and an active authority grant. If any is missing, this will be rejected.
                  </>
                )
              }
              confirmLabel={client.status === "active" ? "Deactivate" : "Reactivate"}
            >
              {client.status === "active" ? "Deactivate client" : "Reactivate client"}
            </ConfirmSubmitButton>
          </form>
        }
      />
```

`StatusBadge`, `ConfirmSubmitButton`, and `EntitySummaryCard` are already imported on line 2
of this file — no import changes needed there. The `destructive`/`outline` `Button` variants
already exist (Increment A's component work; `outline` is used for `ConfirmSubmitButton`'s own
cancel button in `packages/ui/src/components/confirm-dialog.tsx`).

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/clients/[id]/actions.ts apps/ops-console/app/clients/[id]/page.tsx
git commit -m "B3: deactivate/reactivate action and status badge on client detail page"
```

---

### Task 6: `/visits/new` guard against scheduling an inactive client

**Files:**
- Modify: `apps/ops-console/app/visits/new/actions.ts`

- [ ] **Step 1: Add the status check**

In `apps/ops-console/app/visits/new/actions.ts`, the current `scheduleVisit` function reads
(full file, 45 lines):

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function scheduleVisit(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const scheduledStart = String(formData.get("scheduledStart") ?? "");
  const scheduledEnd = String(formData.get("scheduledEnd") ?? "");

  if (!clientId || !providerId || !scheduledStart || !scheduledEnd) {
    redirect(`/visits/new?error=${encodeURIComponent("Client, provider, and start/end times are all required.")}`);
  }

  const supabase = await createClient();

  const { data: carePlan, error: carePlanError } = await supabase
    .from("care_plan")
    .select("id")
    .eq("client_id", clientId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (carePlanError || !carePlan) {
    redirect(
      `/visits/new?error=${encodeURIComponent("This client has no care plan yet — add one before scheduling a visit.")}`,
    );
  }

  const { error: visitError } = await supabase.from("visit").insert({
    client_id: clientId,
    provider_id: providerId,
    care_plan_id: carePlan.id,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
  });

  if (visitError) {
    redirect(`/visits/new?error=${encodeURIComponent(visitError.message)}`);
  }

  redirect("/visits/new?visitScheduled=1");
}
```

Insert a client-status check between the `supabase = await createClient()` line and the
`carePlan` lookup, so the file becomes:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function scheduleVisit(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const scheduledStart = String(formData.get("scheduledStart") ?? "");
  const scheduledEnd = String(formData.get("scheduledEnd") ?? "");

  if (!clientId || !providerId || !scheduledStart || !scheduledEnd) {
    redirect(`/visits/new?error=${encodeURIComponent("Client, provider, and start/end times are all required.")}`);
  }

  const supabase = await createClient();

  const { data: client } = await supabase.from("client").select("status").eq("id", clientId).maybeSingle();

  if (client?.status !== "active") {
    redirect(
      `/visits/new?error=${encodeURIComponent("This client is not active — reactivate them before scheduling a visit.")}`,
    );
  }

  const { data: carePlan, error: carePlanError } = await supabase
    .from("care_plan")
    .select("id")
    .eq("client_id", clientId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (carePlanError || !carePlan) {
    redirect(
      `/visits/new?error=${encodeURIComponent("This client has no care plan yet — add one before scheduling a visit.")}`,
    );
  }

  const { error: visitError } = await supabase.from("visit").insert({
    client_id: clientId,
    provider_id: providerId,
    care_plan_id: carePlan.id,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
  });

  if (visitError) {
    redirect(`/visits/new?error=${encodeURIComponent(visitError.message)}`);
  }

  redirect("/visits/new?visitScheduled=1");
}
```

This matches `apps/ops-console/app/roster/actions.ts#addRosterAssignment`'s existing
suspended-nurse guard shape: read-then-reject-with-a-specific-message before the write,
same pattern as the file's own pre-existing care-plan-existence check two lines below it.

- [ ] **Step 2: Commit**

```bash
git add apps/ops-console/app/visits/new/actions.ts
git commit -m "B3: reject scheduling a visit for an inactive client"
```

---

### Task 7: Typecheck and lint

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the ops-console app**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors. If `client.status` isn't recognized as a string literal type, confirm
Task 4's `types:generate` actually picked up the new column (re-run `supabase db reset` then
`types:generate` if stale).

- [ ] **Step 2: Lint the ops-console app**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 3: Fix and re-run if either fails**

If either command fails, fix the reported issue in the file it names and re-run both commands
until clean. Do not proceed to Task 8 until both pass.

---

### Task 8: Verify end-to-end in the browser against real local Postgres

**Files:** none (verification only)

- [ ] **Step 1: Reset to clean seed state and start the stack**

Run: `supabase db reset` (clean seed data), then `supabase status` to confirm it's running,
then start the ops-console dev server (`pnpm --filter ops-console dev`).

- [ ] **Step 2: Onboard a fresh client and confirm it lands active**

Sign in as a seeded coordinator, complete the `/clients/new` wizard for a brand-new test
client (own name, e.g. "B3 Verification Client") with all five readiness items satisfied,
submit. Then query directly:

```sql
select id, full_name, status from client where full_name = 'B3 Verification Client';
```

Expected: `status = 'active'` — proves the RPC's final `update` ran and the trigger allowed
it (all three structural facts existed by the time that statement ran).

- [ ] **Step 3: Deactivate it and confirm the badge and the visits guard**

Open the new client's `/clients/[id]` page. Confirm the `EntitySummaryCard` shows an
"Inactive"-badge-free "Active" status badge and a "Deactivate client" button. Click it,
confirm the dialog names the client and states the consequence, confirm. Confirm the badge
now reads "Inactive" and the button now reads "Reactivate client". Navigate to `/visits/new`,
attempt to schedule a visit for this client, confirm it's rejected with "This client is not
active — reactivate them before scheduling a visit." and no `visit` row is created (spot-check
via `select count(*) from visit where client_id = '<the test client's id>';` returns `0`).

- [ ] **Step 4: Reactivate it and confirm success**

Back on `/clients/[id]`, click "Reactivate client", confirm. Confirm the badge reads "Active"
again. Confirm `/visits/new` now accepts scheduling a visit for this client (submit one for
real, confirm the `visit` row lands).

- [ ] **Step 5: Confirm the trigger rejects reactivation when the invariant no longer holds**

Deactivate the test client again. On the same page, revoke its only authority grant (the
existing B2 revoke-authority flow). Attempt to reactivate. Confirm the action redirects back
with an `?error=` banner containing the trigger's message ("cannot be activated: requires at
least one emergency contact, one care plan, and one active authority grant"), and confirm via
direct query that `status` is still `inactive`.

- [ ] **Step 6: Clean up and stop the stack**

Delete the test client's rows (`visit`, `authority_grant`, `care_plan`, `emergency_contact`,
`family_sponsor`, `client`, in that FK-safe order) or simply run `supabase db reset` to return
to clean seed state. Stop the dev server and the local Supabase stack (`supabase stop`).

---

### Task 9: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off Increment B3**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist):

```
  - [ ] Increment B3 (worker-tier, after B1/B2): activation-gate enforcement — UI (and ideally a DB check) blocks "active" client status until required evidence, supervisor review, approved care plan, zone, nurse assessment, and emergency-contact readiness are all present
```

Replace with a checked line summarizing what actually got built, in this file's established
style (what was decided, what was found, how it was verified) — write this once the work
above is actually done and verified, not as a template to fill blindly. It should record at
minimum: that the increment reframed scope after finding `onboard_client_with_care_team`
already creates clients atomically-complete (so nothing needed gating at creation time); that
`client.status` is a genuinely new capability (nothing could be marked inactive before this);
that "supervisor review"/"approved care plan" were deliberately left unmodeled, matching B1's
precedent; and the real verification performed (trigger-rejects/trigger-accepts SQL, browser
deactivate/reactivate/reject-scheduling round trip).

- [ ] **Step 2: Add a changelog entry**

Add a new dated bullet under the `### Changelog` section (top of the list reads
chronologically, so add after the most recent 2026-08-10 entries) describing what was built,
matching the density and honesty of the B0/B1/B2 changelog entries already in this file —
real gaps found, real judgment calls made, real verification performed, not a restatement of
the task list.

- [ ] **Step 3: Update the "Last updated" summary line at the top of the file**

Line 6 currently ends with a summary of B2 and says "Increment B3 ... is next." Update it to
reflect B3 is now done and name whichever increment (C1) is next per the epic's own ordering.

- [ ] **Step 4: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment B3, next up Increment C1"
```
