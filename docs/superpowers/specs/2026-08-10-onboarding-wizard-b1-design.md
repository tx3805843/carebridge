# Onboarding wizard (Increment B1) — design

**Date:** 2026-08-10
**Status:** Approved for implementation
**Tier:** Worker-tier (UI/state only — no schema, no RLS, no new tables/columns)

## Context

The UX review (`docs/user-guide/ux-refresh/carebridge-ops-ux-review.md`) and its mockup
(`docs/user-guide/ux-refresh/mockups/onboarding.png`) show client onboarding as a 6-step
draft workflow — Client, Contacts, Assessment, Consent & Authority, Care Plan, Activate —
with a sticky sidebar showing a draft client summary and an activation-readiness checklist,
replacing the current single long form
(`apps/ops-console/app/clients/new/client-form.tsx`).

Two real gaps surfaced while scoping this against the live schema/mockup, both resolved
below rather than silently assumed:

1. **The mockup shows a server-persisted draft** — a client row exists and is editable
   across sessions before "Activate", with "Draft saved · 08:41" chrome. Building that for
   real needs a `client.status` column (`draft`/`active`) and rewriting the existing
   `onboard_client_with_care_team` RPC (`supabase/migrations/
   20260810050000_transactional_client_onboarding.sql`) from one atomic transaction into
   incremental per-step writes. That RPC's entire reason to exist is a real bug this project
   already hit: a multi-step, non-transactional write left an orphaned client with no care
   plan, no contacts, no sponsor when a step failed partway through (see that migration's
   own comment). Real per-step persistence would reintroduce exactly that risk unless done
   very deliberately — genuine schema/RLS work, supervisor-tier per CLAUDE.md, and a separate
   brainstorm from this one.

2. **The mockup's "Assessment" step has no matching schema field.** `care_plan`
   (`supabase/migrations/20260809163000_domain2_client_care_plan.sql`) has only `summary`,
   `effective_from`, `review_due_at` — no assessment concept exists anywhere in the schema.

## Decision

1. **Draft stays entirely client-side.** All 6 steps live in one `<form>` element with
   CSS-toggled visibility per step (only the current step's fieldset is shown; the others
   stay mounted but hidden) — native uncontrolled DOM inputs carry every field's value across
   Next/Back/step-pill navigation with no manual state-shadowing. `Back`/`Next`/step-pill
   clicks are `type="button"`, moving a `currentStep` React state; the one real form
   submission fires only from the final "Activate" step, calling the exact same
   `onboardClient` server action → `onboard_client_with_care_team` RPC as today, same
   atomicity guarantee, zero schema change. Real cross-session server-persisted drafts are
   explicitly out of scope for B1 (see Non-goals) — that's B3's territory once a real
   `client.status`/review model exists.

2. **No session/localStorage persistence either.** Navigating away loses progress, same as
   today's form. Serializing form state to survive a refresh would cut against the
   uncontrolled-DOM simplicity decision 1 just bought, for a feature the roadmap didn't ask
   for in B1.

3. **Step → field mapping**, all writing into the same `onboard_client_with_care_team` RPC
   payload shape as today (no new RPC parameters):
   - **Step 1 — Client:** full name, date of birth, address, zone, referral source (moved
     as-is from the current form's "Client" fieldset).
   - **Step 2 — Contacts:** emergency contacts, add-another pattern (moved as-is from the
     current "Emergency contacts" fieldset).
   - **Step 3 — Assessment:** new — structured prompts (mobility needs, medication needs,
     dietary/behavioral notes), each its own labeled textarea. No new schema field: on
     submit, these are composed with the Step 5 plan-of-action text into one string with
     section headers (e.g. `Mobility needs:\n...\n\nMedication needs:\n...\n\nPlan:\n...`)
     and sent as the RPC's existing `p_care_summary` parameter. This is a real improvement
     over today's one blank textarea, not just a relabeling — it guides the coordinator
     through what a nurse assessment actually needs to capture, using a field that already
     exists.
   - **Step 4 — Consent & Authority:** today's per-sponsor decision-maker/billing-responsible
     checkboxes, moved as-is from the current "Family sponsors" fieldset (sponsor name,
     email, relationship, the two checkboxes). The mockup's rich per-authority-type cards
     (evidence, effective period, revoke, escort, photography) are explicitly **Increment
     B2's** job (`carebridge-roadmap.md`: "Consent & Authority step UI wired to B0's
     tables") — not rebuilt here.
   - **Step 5 — Care plan:** plan-of-action textarea (feeds into `p_care_summary` per Step
     3's composition) + review-due-at date (moved as-is).
   - **Step 6 — Activate:** read-only summary of everything entered across steps 1-5, plus
     the real submit button (`type="submit"`, only rendered/enabled on this step).

4. **Sidebar** — computed live from current in-DOM form state via a `FormData`/`change`-event
   read (no server round-trip): client name/DOB/zone once Step 1 is filled, and a readiness
   checklist covering exactly Steps 1-5 (Identity & zone / Emergency contact ready /
   Assessment noted / Authority captured / Care plan drafted). **Deliberately does not
   include the mockup's "Supervisor review" / "Approved care plan" pending items** — there is
   no approval/review workflow anywhere in this schema, and showing fake pending states would
   repeat the exact dishonest-UI pattern the review itself flagged and Increment A0 already
   fixed once (the false "Send invite" promise). That review workflow is B3's job, once one
   exists for real — B1 must not simulate it.

5. **Navigation:** free jump between step pills at any time (real onboarding conversations
   don't always proceed in strict order — a coordinator might capture sponsor info before
   finishing the clinical assessment). The Activate button is disabled (not hidden) until
   every field required by the current RPC contract is filled across all 6 steps, validated
   client-side. This is the review's "constrain choices early" rule applied to the one place
   it actually matters here (final submission), without forcing an artificial strict-linear
   flow the mockup itself doesn't actually require (its step pills are independently
   clickable with checkmarks, not a locked sequence).

6. **"Save & close" is dropped**, replaced with a plain "Cancel" link back to the client
   list. Per decision 1/2, there is nothing server-side to save — a button implying otherwise
   would be dishonest UI.

## Non-goals (explicitly out of scope for B1)

- Server-persisted draft clients, a `client.status` column, or incremental per-step RPCs —
  real schema/RLS work, a separate supervisor-tier brainstorm, likely folded into whatever
  builds B3's activation gate for real.
- The rich per-authority-type Consent & Authority cards (evidence, effective period, revoke,
  escort, photography, emergency-contact) from the mockup — Increment B2.
- Any "Supervisor review" / approval workflow — no schema for it exists; not simulated here.
- Session/localStorage progress persistence.
- New RPC parameters or `onboard_client_with_care_team` signature changes — the RPC's
  contract is unchanged; only the UI collecting its inputs is restructured.

## Risks / open items for implementation

- Confirm the existing `onboardClient` server action (`apps/ops-console/app/clients/new/
  actions.ts`) needs no changes beyond what already reads `FormData` — the wizard still
  submits one `<form>` with the same field names, just reorganized visually.
- The Activate-button disable logic needs to read live `FormData` (or track required-field
  fill state via `onChange` handlers) across all 6 steps' fields, including the
  dynamically-added contact/sponsor rows — verify the add-another pattern's dynamic
  `name={`sponsorFullName-${index}`}`-style fields are covered by whatever validation
  mechanism is chosen, not just the first static row.
- Verify keyboard/focus behavior when switching steps (focus should move to the new step's
  first field or heading, not stay on the now-hidden previous step's last-focused element) —
  this is the same accessibility bar Increment A cont'd already established for this app;
  don't regress it here.
