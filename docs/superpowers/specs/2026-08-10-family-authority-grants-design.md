# Family authority grants (Increment B0) — design

**Date:** 2026-08-10
**Status:** Approved for implementation
**Tier:** Supervisor-tier (CLAUDE.md: schema design, RLS policy authorship, consent/access
model, and — because it rewrites `internal.is_billing_responsible_sponsor()` — financial
logic)

## Context

`carebridge-roadmap.md`'s "Epic: Ops Console UX Refresh" accepted a UX review
(`docs/user-guide/ux-refresh/carebridge-ops-ux-review.md`) whose Increment B ("client
activation") assumed a UI-only refresh of `client_relationship.is_decision_maker` /
`is_billing_responsible`. Confirming against the live schema, this is not UI-only:

- `client_relationship` (`supabase/migrations/20260809160000_domain1_identity_access.sql`)
  has exactly two booleans: `is_decision_maker`, `is_billing_responsible`.
- `is_billing_responsible` is load-bearing today: `internal.is_billing_responsible_sponsor()`
  (`20260810030000_domain8_billing_phase1.sql`) uses it to gate real invoice/payment RLS
  policies, and it's queried directly by `supabase/functions/stripe-webhook/index.ts`,
  `supabase/functions/paystack-webhook/index.ts`, `apps/ops-console/lib/whatsapp.ts`, and
  `apps/ops-console/app/billing/[id]/actions.ts` to decide who gets billing notifications.
- `is_decision_maker` drives an insert into `decision_maker_hierarchy` at onboarding
  (`20260810050000_transactional_client_onboarding.sql`).
- A `consent_grant` table (same migration as `client_relationship`) already exists and
  already gates `care_plan` reads for family sponsors via `scope = 'clinical_detail'`, per
  CLAUDE.md's "RLS resolves through consent_grant, not role alone." It also has `billing`,
  `location_tracking`, and `photos` scopes.
- A separate `emergency_contact` table (`20260809163000_domain2_client_care_plan.sql`)
  already exists, is not linked to `family_sponsor` at all (free-text name/phone/priority),
  and that migration's own design note already classifies it as "structural/safety data" a
  linked sponsor can see without a consent grant — distinct from consent-gated clinical
  detail.

The UX review's rule 8 ("Do not merge family relationship with authority. Relationship,
payer responsibility, care-decision authority, health-update authority, escort authority,
and emergency-contact authority remain separate") is the actual requirement. Mapped against
what exists today, only two of those six are unmodeled booleans in need of replacement
(decision-maker, billing-responsible); one is net-new (escort); two are already correctly
modeled as `consent_grant` scopes (health-update → `clinical_detail`, photography →
`photos`); and one already has its own adequate table (`emergency_contact`).

## Decision

1. **New table `authority_grant`** — polymorphic, matching the existing
   `consent_grant`/`credential` pattern (`text` + `check`, not an enum, so a new authority
   type is a plain migration, not `ALTER TYPE`). Covers exactly the three authority types
   with no existing home: `decision_maker`, `billing_responsible`, `escort`.

   ```sql
   create table authority_grant (
     id uuid primary key default gen_random_uuid(),
     client_id uuid not null references client(id),
     sponsor_id uuid not null references family_sponsor(id),
     authority_type text not null check (authority_type in ('decision_maker', 'billing_responsible', 'escort')),
     status text not null default 'active' check (status in ('pending', 'active', 'revoked', 'rejected')),
     evidence_document_ref text,          -- Supabase Storage object path, same convention as credential
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
   ```

   `client_id` is denormalized (derivable from `sponsor_id` → `family_sponsor.client_id`)
   for RLS/query simplicity — same convention `client_relationship` and `consent_grant`
   already use; no cross-consistency trigger, matching the existing looseness precedent
   (`consent_grant` doesn't validate `grantee_user_id` against `client_id` either — trusted
   at the application layer, same posture kept here).

   `status` defaults to `'active'`: the current onboarding flow writes these facts directly
   as a trusted coordinator decision, same trust level as today's boolean — no functional
   regression. `pending`/`rejected` exist so **B2** (Consent & Authority step UI) and **B3**
   (activation-gate enforcement) have real states to build against later. B0 does not build
   a review/approval workflow — that's B2/B3's job.

2. **`client_relationship` is dropped**, not kept as a bare link table — but only after a
   data-backfill step in the same migration copies every existing `is_decision_maker = true`
   / `is_billing_responsible = true` row into `authority_grant` first (`status = 'active'`,
   `granted_at`/`granted_by` sourced from the old row's `created_at`/`created_by`). Order
   within the migration: create `authority_grant` → backfill from `client_relationship` →
   rewrite dependent functions → drop `client_relationship`. This matters regardless of
   whether real rows exist yet — a migration that silently drops data if any existed is wrong
   on principle, not just for today's seed data. Once the two
   booleans move out it carries zero non-redundant data: `family_sponsor` already uniquely
   links `(user_id, client_id)` with a `relationship` label, and
   `client_relationship.sponsor_id` already implies `client_id` through that same row. No
   RLS policy elsewhere keys off `client_relationship` for base linkage —
   `internal.is_linked_sponsor()` (used by `client`/`care_plan` RLS) already keys off
   `family_sponsor` directly.

3. **`consent_grant` is untouched.** Health-update/photography/consent authority stay
   exactly what they are today — `clinical_detail`/`photos` scopes on `consent_grant`. No
   new scope values, no schema change. Two parallel mechanisms answering "can this sponsor
   see clinical detail" was explicitly rejected as a drift risk in a safety-relevant system.

4. **`emergency_contact` is untouched.** It's already a distinct table, already not derived
   from sponsor linkage, already satisfies rule 8 without changes.

5. **Full cutover, no shim.** Same migration replaces every reader of the two dropped
   booleans:
   - `internal.is_billing_responsible_sponsor()` — rewritten to query `authority_grant`
     (`authority_type = 'billing_responsible' and status = 'active'`, joined through
     `family_sponsor` to `auth.uid()`). Defined via `create or replace function` in the new
     migration (the original migration file is not edited — already applied/historical).
   - `supabase/functions/stripe-webhook/index.ts`,
     `supabase/functions/paystack-webhook/index.ts`,
     `apps/ops-console/lib/whatsapp.ts`,
     `apps/ops-console/app/billing/[id]/actions.ts` — all four currently
     `.eq("is_billing_responsible", true)` against `client_relationship`; rewritten to query
     `authority_grant`.
   - The transactional-onboarding Postgres function
     (`20260810050000_transactional_client_onboarding.sql`) — currently inserts into
     `client_relationship` and conditionally into `decision_maker_hierarchy`. Rewritten (new
     migration, `create or replace function`) to insert `authority_grant` rows per truthy
     flag instead of `client_relationship`; the `decision_maker_hierarchy` insert condition
     is re-keyed off the same flags (unchanged logic, just no longer reading them back off a
     row that no longer exists).
   - `apps/ops-console/app/clients/new/actions.ts` — passes
     `is_decision_maker`/`is_billing_responsible` into that RPC; field names into the RPC's
     `jsonb` payload stay the same (the RPC's internal handling changes, not its input
     contract), so this file likely needs no change — confirmed during implementation.
   - `supabase/seed.sql` — currently inserts a `client_relationship` row directly; rewritten
     to insert `authority_grant` rows.
   - `docs/domain-model.md` — Domain 1 row's table list updated
     (`client_relationship` → `authority_grant`).
   - `packages/domain/src/generated.ts` — regenerated after the migration lands
     (`pnpm --filter @carebridge/db types:generate`), standard post-migration step already
     used by every prior Domain migration in this project.

6. **RLS on `authority_grant`** — same self-or-staff / staff-write shape as every other
   Domain 1 table:

   ```sql
   alter table authority_grant enable row level security;

   create policy authority_grant_select_self_or_staff on authority_grant
     for select to authenticated
     using (
       internal.is_staff()
       or exists (select 1 from family_sponsor fs where fs.id = sponsor_id and fs.user_id = auth.uid())
     );

   create policy authority_grant_write_staff on authority_grant
     for all to authenticated
     using (internal.is_staff())
     with check (internal.is_staff());
   ```

   Audit trigger (`authority_grant_audit`) and `updated_at` trigger attached, matching every
   other table in this schema. Grants: `select, insert, update, delete` to `authenticated`
   and `service_role` (the webhooks run as `service_role`).

7. **ADR-0005** (`docs/adr/0005-family-authority-grants-not-relationship-booleans.md`) records
   this decision: context (booleans conflated relationship with authority, load-bearing for
   real billing RLS), decision (new `authority_grant` table; drop `client_relationship`;
   `consent_grant` and `emergency_contact` unchanged), alternatives rejected (extend
   `consent_grant` with new scopes — conflates read-access with real-world responsibility,
   and decision-maker/emergency-contact were deliberately modeled as *not* requiring a
   consent grant; keep `client_relationship` as a bare link table — zero unique data
   survives the split).

## Non-goals (explicitly out of scope for B0)

- No review/approval UI or workflow for `pending` → `active` transitions — that's B2/B3.
- No retrofit of `consent_grant` to add `revoked_by`/evidence/effective-period columns for
  parity with `authority_grant`, even though the review's language ("evidence reference,
  effective period, revoked_at/revoked_by") technically describes both. `consent_grant`'s
  existing shape (`granted_at`/`revoked_at` only) is unchanged; flagged here as a possible
  future consistency pass, not built now (YAGNI — nothing currently needs it).
- No `client_relationship`-equivalent `relationship_type` free-text column added anywhere;
  `family_sponsor.relationship` already carries that.
- Onboarding UI (B1), Consent & Authority step UI (B2), activation-gate enforcement (B3) are
  separate roadmap items, not built in B0.

## Risks / open items for implementation

- Confirm `apps/ops-console/app/clients/new/actions.ts`'s RPC call payload needs no change
  (stated above as "likely" — verify against the actual function signature during
  implementation, not assumed).
- `rls-coverage` CI check must pass on the new table (created_at/updated_at/created_by +
  RLS + ≥1 policy) — automatic given the shape above, but confirm via
  `pnpm --filter @carebridge/db migrate:dry-run` / local `supabase db reset`.
- This is real financial-access-control logic (CLAUDE.md: "Financial logic... is
  supervisor-tier"). Verify for real against local Postgres with role-impersonation for all
  three authority types before considering this closed, not just `tsc`/lint.
