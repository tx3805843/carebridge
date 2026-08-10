# Consent & Authority management (Increment B2) — design

**Date:** 2026-08-10
**Status:** Approved for implementation
**Tier:** Worker-tier (UI + server actions against already-designed tables — no schema, no RLS
change; CLAUDE.md's worker-tier bucket explicitly covers "CRUD scaffolding for an
already-designed table")

## Context

The roadmap describes Increment B2 as: "Consent & Authority step UI wired to B0's tables —
each authority shown independently with Required/Optional, Captured/Needs review/Not
granted, evidence link, effective period, revoke."

Two real gaps surfaced before building, both resolved below:

1. **The mockup's per-authority cards (evidence upload, revoke) are inherently
   post-creation operations** — they need a real `client_id` and real `family_sponsor` rows
   to attach to. But `apps/ops-console/app/clients/new/client-form.tsx` (Increment B1)
   deliberately keeps the entire onboarding wizard client-side/in-memory until one atomic
   submit at Activate — no client exists mid-flow, on purpose, to avoid reintroducing the
   orphaned-client bug `onboard_client_with_care_team` was built to fix. There is nowhere
   for "wire the rich card UI into the onboarding step" to actually attach real rows to.
2. **There is no client detail page anywhere in this app** (`apps/ops-console/app/clients`
   has only `new/`, no `[id]` route) and **no client list/search page either** — so even
   after building a detail page, there's no existing navigation path to it.

## Decision

1. **New route `apps/ops-console/app/clients/[id]/page.tsx`**, mirroring the existing
   `apps/ops-console/app/providers/[id]/page.tsx` pattern exactly: server component,
   `EntitySummaryCard` header, `DataTable` for any list content, one bound server action per
   form (`action.bind(null, clientId)`), `useToast`-free plain success/error query-param
   messages — same conventions this app already uses everywhere, not a new pattern. Scoped
   narrowly to what B2 asks for: client identity header, sponsors list, and the Consent &
   Authority section. Visits/billing/scheduling for a client stay out of scope — this is not
   a general client-management page.

2. **Navigation**: no clients list/search page is built (unscoped, separate future work — not
   named in the roadmap under B0-D). The only path to `/clients/[id]` is `apps/ops-console/
   app/clients/new/page.tsx`'s onboarding-success message, changed from plain text
   ("Client onboarded (id {onboarded})") to a link to the new detail page. This is the
   minimum navigation needed to actually use and verify B2, not a claim that client discovery
   is solved.

3. **The cards are not uniform, because the backing tables are not uniform** — B0's design
   spec explicitly declined to retrofit `consent_grant` with `authority_grant`'s richer shape
   (evidence/effective-period/`revoked_by`), so this UI must render each authority according
   to what its own table actually supports, not fake a shared shape:

   - **Decision-maker, Payer (billing_responsible), Escort** — backed by `authority_grant`.
     Full-featured card: status derived as
     - *Not granted* — no `active` or `pending` row for this `(client, sponsor,
       authority_type)`.
     - *Needs review* — a `pending` row exists, no `active` row.
     - *Captured* — an `active` row exists.
     (A `revoked`/`rejected` row with no other active/pending row for that type displays as
     *Not granted* — the badge reflects current effect, not history; the revoked row itself
     stays queryable/auditable via the table, not surfaced as a fourth badge state.)
     Fields: sponsor picker, evidence-document-ref text input (Storage path convention, same
     as `credential.evidence_document_ref` — no upload widget), effective-from/until dates.
     Revoke button sets `status='revoked'`, `revoked_at=now()`, `revoked_by=auth.uid()` on
     the active row.
   - **Health-update (`consent_grant` scope `clinical_detail`), Photography (scope
     `photos`)** — backed by `consent_grant`. Simpler by design: *Not granted* / *Captured*
     only (no *Needs review* — `consent_grant` has no status lifecycle, just
     `granted_at`/`revoked_at`). No evidence/effective-period fields — those columns don't
     exist on this table and B0 deliberately left it that way. Revoke sets `revoked_at`.
   - **Client consent to receive care** — backed by `consent_record` (Domain 9, already
     exists), client-level not per-sponsor. One capture form: document ref + signed date.
     No "revoke" concept for this one (a signed physical/scanned consent record is a
     historical fact, not a toggle — matches `consent_record`'s own existing shape, which
     has no `revoked_at`).

4. **New grants go straight to `active`**, not `pending` — same trust model as
   `onboard_client_with_care_team`'s onboarding-time grants (the coordinator entering it here
   is equally trusted). B2 does not build a review/approval workflow to actually produce
   `pending` rows through this UI. The `pending`/*Needs review* badge state stays supported
   by the derivation logic (so a future increment that does create `pending` rows renders
   correctly) but B2 itself never produces one — no fabricated workflow for a state nothing
   currently gates on.

5. **Server actions** (`apps/ops-console/app/clients/[id]/actions.ts`), each bound to the
   client id from the page, following the exact pattern already used by
   `apps/ops-console/app/providers/[id]/actions.ts`:
   - `grantAuthority(clientId, formData)` — inserts an `authority_grant` row
     (`authority_type`, `sponsor_id`, optional `evidence_document_ref`/`effective_from`/
     `effective_until`), `status='active'`, `granted_at=now()`, `granted_by=auth.uid()`.
   - `revokeAuthority(clientId, formData)` — updates the targeted `authority_grant` row to
     `status='revoked'`, `revoked_at=now()`, `revoked_by=auth.uid()`.
   - `grantConsent(clientId, formData)` — upserts a `consent_grant` row (`scope` ∈
     `clinical_detail`/`photos`, `grantee_user_id` resolved from the chosen sponsor's
     `family_sponsor.user_id`, `granted_at=now()`), respecting the existing partial unique
     index (`client_id, grantee_user_id, scope) where revoked_at is null`).
   - `revokeConsent(clientId, formData)` — sets `revoked_at=now()` on the targeted
     `consent_grant` row.
   - `recordConsent(clientId, formData)` — inserts a `consent_record` row (`document_ref`,
     `signed_at`).

## Non-goals (explicitly out of scope for B2)

- Clients list/search page.
- Emergency-contact editing on this page — already fully handled at onboarding (B1);
  editing an existing emergency contact isn't an "authority" and isn't in B2's stated scope.
- Any review/approval workflow that produces `pending` `authority_grant` rows for real.
- File upload widget — evidence stays a typed Storage-path reference, matching
  `credential.evidence_document_ref`'s existing convention exactly.
- Retrofitting `consent_grant` with evidence/effective-period/`revoked_by` columns for parity
  with `authority_grant` — B0 already declined this; still declined here.
- General client management (visits, billing, care-plan editing) on this page.

## Risks / open items for implementation

- Confirm `grantConsent`'s upsert correctly re-activates a previously-revoked scope (i.e., a
  new grant after a revoke) given the partial unique index only covers *unrevoked* rows —
  verify the actual SQL/upsert behavior against a real revoke-then-regrant sequence, not
  assumed.
- Confirm RLS: `authority_grant`/`consent_grant`/`consent_record` are all already staff-write
  (existing policies from Domain 1/9 and B0) — this page's actions run as the authenticated
  staff session same as every other write in this app, no new RLS needed, but verify by
  actually driving the page as `coordinator1`, not just by reading the policy SQL.
- Verify the sponsor picker only ever offers sponsors actually linked to this client
  (`family_sponsor.client_id = this client`), not all sponsors in the system.
