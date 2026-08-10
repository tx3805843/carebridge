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
