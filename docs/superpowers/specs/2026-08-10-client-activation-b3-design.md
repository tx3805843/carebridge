# Increment B3: client activation-gate enforcement — design

**Date:** 2026-08-10
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic, Increment B3

## Context

The review mockup (`docs/user-guide/ux-refresh/carebridge-ops-ux-review.md`) calls for
"explicit client activation gates for consent, authority, assessment, care-plan approval, and
emergency readiness" and says the UI must not imply an active client until every required gate
is complete, authorized, and auditable.

The roadmap's own note going into this increment already flagged the real schema gap: `client`
(`supabase/migrations/20260809163000_domain2_client_care_plan.sql`) has no `status` column at
all today. Investigating further surfaced a second fact that reframes the whole increment: the
only path that creates a `client` row is `onboard_client_with_care_team` (rewritten by B0 in
`20260810070000_family_authority_grants.sql`), an atomic RPC that already requires identity,
zone, ≥1 emergency contact, a care plan, and (via B1's client-side readiness checklist) an
authority grant before it can be called. **No client can exist half-built today.** There is
nothing to gate at creation time — B1 already gates it, client-side.

Two of the mockup's five named gates — "supervisor review" and "care-plan approval" — also
don't correspond to any entity anywhere in the schema. B1 already made the call not to fake a
review/approval workflow that doesn't exist (its own design doc explicitly declines the
mockup's "Supervisor review"/"Approved care plan" pending states, citing the same
dishonest-UI pattern Increment A0 fixed once already for "Send invite"). This design carries
that precedent forward rather than reversing it.

Given that, B3's real, honest scope is: (1) give `client` an actual `status` lifecycle for the
first time — nothing today can ever mark a client inactive, which is a genuine gap independent
of "activation gates" — and (2) back it with a real DB-enforced invariant over the three
structural facts that *do* exist as rows (contacts, care plan, authority), so the gate is a
database guarantee, not just a client-side checklist that a future second creation path could
bypass.

## Schema

New migration, `supabase/migrations/<ts>_client_activation_status.sql`:

```sql
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
```

`internal.check_client_activation_ready` lives in `internal` (not `public`) matching the
existing convention for RLS/invariant helper functions that must never be directly callable via
PostgREST RPC (`20260809180000_security_hardening.sql`). The trigger function itself is in
`public` — triggers aren't independently callable the way RPC functions are, so this matches
`set_updated_at`/`provider_enforce_role`'s existing placement.

No RLS change needed — `status` is a plain column on an already-covered table, and the trigger
runs regardless of caller (it's `before insert or update`, not `security definer` — it doesn't
need elevated privilege, it just reads sibling tables the caller could already read/write).

`client_relationship`'s drop and `authority_grant`'s add already went through `rls:check`
(35 tables); this migration adds no new table, so no coverage-check impact.

## Onboarding RPC change

`onboard_client_with_care_team` (`20260810070000_family_authority_grants.sql`) inserts `client`
first, then `care_plan`/`emergency_contact`/`authority_grant` rows in the same transaction. Add
one final statement before `return v_client_id`:

```sql
update client set status = 'active' where id = v_client_id;
```

Because this `UPDATE` runs *after* every other insert in the same transaction, the trigger's
`internal.check_client_activation_ready` check sees the complete picture and passes. The
initial `insert into client (...)` is unchanged and gets the column's `'inactive'` default —
consistent with "a client isn't real until the RPC's last statement says so," which is what
"activation" should mean literally. No RPC signature change, no caller change
(`apps/ops-console/app/clients/new/actions.ts` needs zero edits) — same zero-blast-radius shape
as B0's cutover.

If the RPC's own inserts ever violated the invariant (they can't today — B1's client-side
checklist guarantees non-empty payloads before submit is even enabled), the final `UPDATE`
would raise and the whole transaction — including the earlier inserts — rolls back. That's the
point of putting the check in a trigger on `client` rather than only in application code: it
holds even if a future second creation path (a fixture script, a support tool, a different RPC)
forgets to replicate B1's client-side rule.

## `/clients/[id]` detail page

- `EntitySummaryCard`'s `meta` gets a `Status` entry rendering `StatusBadge` (`success` variant
  for `active`, `neutral` for `inactive` — matching `StatusBadge`'s existing variant vocabulary
  used elsewhere in this app, e.g. credential status).
- New action in `EntitySummaryCard`'s `actions` slot: a `ConfirmSubmitButton` toggling
  status — "Deactivate client" when active, "Reactivate client" when inactive. Confirmation
  copy names the client and states the consequence (deactivating stops new visit scheduling;
  reactivating re-checks the same readiness invariant the trigger enforces, so a client who's
  since lost their only authority grant can't be silently reactivated).
- New server actions in `app/clients/[id]/actions.ts`, matching the existing
  `grantAuthority`/`revokeAuthority` shape exactly (`requireStaffUser()`, redirect-with-error
  on failure, redirect-with-`updated` on success):

```ts
export async function deactivateClient(clientId: string) {
  await requireStaffUser();
  const supabase = await createClient();
  const { error } = await supabase.from("client").update({ status: "inactive" }).eq("id", clientId);
  if (error) redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/clients/${clientId}?updated=status`);
}

export async function reactivateClient(clientId: string) {
  await requireStaffUser();
  const supabase = await createClient();
  const { error } = await supabase.from("client").update({ status: "active" }).eq("id", clientId);
  if (error) redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/clients/${clientId}?updated=status`);
}
```

The trigger's exception surfaces through Supabase's Postgres error message on `reactivateClient`
(same "read `error.message`, redirect with it" pattern every existing action in this file
already uses for RLS-rejection messages — no special-casing needed).

The page's initial `client` `select` needs `status` added to its column list.

## `/visits/new` guard

`scheduleVisit` (`apps/ops-console/app/visits/new/actions.ts`) gets one more read-and-reject
step, inserted alongside the existing care-plan-existence check, same shape as
`app/roster/actions.ts#addRosterAssignment`'s suspended-nurse guard:

```ts
const { data: client } = await supabase.from("client").select("status").eq("id", clientId).maybeSingle();

if (client?.status !== "active") {
  redirect(`/visits/new?error=${encodeURIComponent("This client is not active — reactivate them before scheduling a visit.")}`);
}
```

## Deliberately not modeled

"Supervisor review" and "approved care plan" from the review mockup stay unbuilt. No such
entities exist anywhere in the schema (no `care_plan.status`, no review/approval table), and B1
already declined to fake this exact pair of states for the same reason A0 fixed the false "Send
invite" promise: a UI element implying a workflow that doesn't actually run is worse than no
element at all. The DB invariant instead checks the three structural facts that genuinely
exist and genuinely matter — a client with no emergency contact, no care plan, or no one with
authority over them is not safely activatable regardless of what a review workflow would have
said.

"Nurse assessment" likewise has no dedicated entity — B1 already folds assessment prompts into
`care_plan.summary`'s composed text (`apps/ops-console/app/clients/new/client-form.tsx`'s
`composeCareSummary`). The invariant's `care_plan` existence check is the closest honest proxy;
a separate structured assessment entity is out of scope here, unchanged from B1's decision.

## Out of scope, follow-up candidates

- Any RLS visibility change for `client.status` (linked sponsors already see structural
  `client` fields without consent per the Domain 2 design note; `status` is more structural
  data of the same kind, no new policy needed, but not exhaustively re-verified against every
  existing sponsor-read policy in this design pass).
- Extending the `status != 'active'` guard to other write paths that touch a client (e.g. new
  authority grants, care-plan updates) — only `/visits/new` was in scope per this session's
  scoping decision. If a real gap surfaces there later, log it the way B2's cross-client-
  ownership gap was logged rather than silently expanding this increment.

## Verification plan

Same bar as B0/B1/B2 — real local Postgres, not just typechecked:

1. `supabase db reset`, confirm migration applies clean, `rls:check` still passes (no new
   table, so table count unchanged).
2. Role-impersonation SQL: confirm the trigger rejects a direct `update client set
   status='active'` on a client with zero authority grants; confirm it accepts one that has
   all three structural facts.
3. Drive the browser: onboard a fresh client through B1's wizard, confirm it lands
   `status='active'` via direct Postgres query (proving the RPC's final `UPDATE` fires and
   passes). Deactivate it from `/clients/[id]`, confirm the badge flips and `/visits/new`
   rejects scheduling against it with the new error message. Reactivate it, confirm it
   succeeds (all three facts still present). Deactivate it again, revoke its only authority
   grant while inactive, then attempt reactivate — confirm the trigger rejects it with a
   readable error surfaced through the page's existing `?error=` banner.
4. `pnpm --filter ops-console typecheck` and `lint` clean.
