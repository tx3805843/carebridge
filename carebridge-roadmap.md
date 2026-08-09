# CareBridge Build Roadmap & Status

**This is a living file — read it first, every session; update it last, every session.**
Companion to `carebridge-architecture-and-build-prompt.md` (the stable design brief — read that only for "why," not "what's next"). Move this file to `docs/ROADMAP.md` once the repo is scaffolded (Phase 0).

Last updated: 2026-08-09 — Phase 0 schema + seed work is complete (all Domains 1-3 & 9, 22 tables, all RLS-verified against real local Postgres; `supabase/seed.sql` fixtures in place). Two external blockers remain before Phase 1 can unlock: no hosted Supabase project provisioned yet, and CI has never run (GitHub account `tx3805843` is suspended, blocking `git push`) — see changelog and "Open questions" for detail.

---

## How to use this file (read this block every session)

1. Find the **Current phase** below. Work only inside that phase's checklist.
2. Do not touch a locked phase's checklist. A phase unlocks only when the prior phase's **exit criteria** are all checked. **This phase gate governs the software/app build track only** — it sequences what code gets written, not the whole company. Non-app operational workstreams (DPC registration, HeFRA licensing, KYC vendor selection, DataFlow PSV, Meta Business Manager + WhatsApp template approval) run on a **parallel track** and are **not** blocked by the app phase gate; several are meant to start early (Meta/WhatsApp approval in Phase 0). Progress them independently — they're tracked in the Phase 0 exit criteria and the "Open questions / decisions pending" section below.
3. When you finish a story: check it off, add a changelog line (date, one sentence, who/what agent), and note any newly discovered stories under the relevant epic instead of silently expanding scope.
4. If you're a worker-tier agent (per Part 7 of the architecture brief): you should only ever need this file plus the specific work order you were given — you should not need to re-read the full architecture brief to know what to build next.
5. If you're the supervisor: re-read the architecture brief when a design question comes up (schema shape, RLS approach, credentialing rules) — not for routine "what's next" questions, which this file answers.

---

## Current phase: Phase 0 — Foundations & Compliance Readiness

**Status:** Not started
**Started:** —
**Target:** Weeks 1-4 (see architecture brief, Part 5)

### Exit criteria (must all be true before Phase 1 unlocks)
- [x] Repo scaffolded exactly per architecture brief Part 4 (added the one gap found this session, `.env.example`, documenting Supabase/WhatsApp/Paystack/Stripe/KYC-vendor env vars with no real values)
- [ ] Supabase project provisioned (EU region — see brief Part 1.1 for rationale)
- [ ] CI green (lint, typecheck, migration dry-run) on an empty app
- [x] Core schema live with RLS on every table: Identity & Access, Client & Care Plan, Provider & Credentialing, Compliance & Audit
- [x] `credential_type` registry seeded (Ghana Card, NMC PIN/AIN, police report, reference check, CPD record)
- [x] Audit log triggers live and tested before any real data enters the system
- [x] No table exists without an RLS policy — verified by a CI check, not manual review (`rls-coverage` CI check, all 18 tables pass)

### Checklist
- [x] Monorepo scaffolded (pnpm workspaces, Turborepo, folder structure per Part 4) — pre-existing from repo scaffold commit, confirmed still correct this session
- [x] `packages/db` — Supabase migrations scaffolding
- [x] `packages/domain` — shared TypeScript types (generation strategy decided)
- [x] `packages/config` — shared eslint/tsconfig/tailwind
- [x] ADR: why Supabase over self-hosted Postgres at launch
- [x] ADR: why EU region pending Ghana data-localization requirements
- [x] Domain 1 schema: `user`, `role`, `family_sponsor`, `client_relationship`, `consent_grant` + RLS (`supabase/migrations/20260809160000_domain1_identity_access.sql`)
- [x] Domain 2 schema: `client`, `care_plan`, `emergency_contact`, `decision_maker_hierarchy` + RLS (`supabase/migrations/20260809163000_domain2_client_care_plan.sql`) — also backfilled the deferred FK constraints on `family_sponsor.client_id`, `client_relationship.client_id`, `consent_grant.client_id`
- [x] Domain 3 schema: `provider`, `credential`, `credential_verification_event`, `identity_verification`, `background_check`, `training_record`, `verified_profile` + RLS (`supabase/migrations/20260809170000_domain3_provider_credentialing.sql`) — also created and seeded `credential_type` (satisfies the exit-criterion registry above)
- [x] Domain 9 schema: `consent_record`, `dpc_registration`, `audit_log`, `incident_report`, `data_retention_policy` + RLS — `audit_log` in `supabase/migrations/20260809173000_domain9_audit_log.sql`; the rest in `supabase/migrations/20260809176000_domain9_compliance_records.sql`
- [x] Postgres triggers populate `audit_log` automatically on every table — retrofitted onto all 17 Domain 1-3 tables in `supabase/migrations/20260809173000_domain9_audit_log.sql`
- [x] CI pipeline: lint, typecheck, migration dry-run, RLS-coverage check
- [x] Seed data script generates realistic-but-synthetic Ghanaian dev data (no real PII, ever) — `supabase/seed.sql`, run via `pnpm --filter @carebridge/db seed`

### Changelog
- 2026-08-09 — Roadmap file created from architecture brief v1 (Parts 4, 5, 9).
- 2026-08-09 — Clarified in "How to use this file" that the phase gate governs the app/code track only; non-app operational workstreams run in parallel. Added CLAUDE.md.
- 2026-08-09 — Added ADR-0004 (Supabase over self-hosted Postgres at launch). Added `packages/db/scripts/check-rls-coverage.mjs` + `rls-coverage` CI workflow, enforcing created_at/updated_at/created_by + RLS-enabled + ≥1 policy on every table created under `supabase/migrations/`. CI is currently a no-op pending real migrations — next story (Domain 1 schema) is what will actually exercise it.
- 2026-08-09 — Landed Domain 1 schema + RLS (`role`, `user`, `family_sponsor`, `client_relationship`, `consent_grant`) in `supabase/migrations/20260809160000_domain1_identity_access.sql`. Passes `rls:check`.
- 2026-08-09 — Verified Domain 1 against a real local Postgres: installed Supabase CLI (prebuilt binary — `brew install` failed on outdated Command Line Tools, needs a system update to fix properly) and ran `supabase start` (Docker). Migration applied cleanly. Confirmed by direct query: all 5 tables + RLS enabled + 10 policies + 6 triggers + 6 seeded roles exist as designed. Exercised end-to-end as real Postgres roles (not just read the SQL): `handle_new_auth_user` trigger correctly creates a `user` row on `auth.users` insert (default family_sponsor role, or explicit role_id from metadata — tested a coordinator); RLS correctly lets a sponsor see only their own `user`/`family_sponsor`/`client_relationship`/`consent_grant` rows, lets staff (`is_staff()`) see all rows, and blocks a same-role bystander from reading or updating another family's rows; the `consent_grant_active_unique` partial index correctly rejects a duplicate active grant. Local stack left running (`supabase status` / Studio at http://127.0.0.1:54323; `supabase stop` to shut down). Known follow-ups unchanged: Domain 2 must backfill `client_id` FKs; Domain 9 must retrofit audit triggers; staff invite flow still open (see "Open questions" below).
- 2026-08-09 — User installed Supabase CLI properly via Homebrew (`/opt/homebrew/bin/supabase`, replacing the scratchpad binary workaround).
- 2026-08-09 — Landed Domain 2 schema + RLS (`client`, `care_plan`, `emergency_contact`, `decision_maker_hierarchy`) in `supabase/migrations/20260809163000_domain2_client_care_plan.sql`, and backfilled the FK constraints on `family_sponsor.client_id`, `client_relationship.client_id`, `consent_grant.client_id` deferred from the Domain 1 migration. Passes `rls:check` (9 tables). Verified against real local Postgres via `supabase db reset` (clean reapply of both migrations from scratch) plus role-impersonation tests: a linked family sponsor can read `client` and `emergency_contact` immediately (structural data), but `care_plan` (clinical detail) is invisible until an explicit `consent_grant` with `scope='clinical_detail'` exists — then becomes visible. This is the guardrail's core scenario, proven against real Postgres, not just designed on paper. New known follow-up: `client.zone_id` is an unconstrained FK pending Domain 4 (Phase 1 scope) — see "Open questions" below.
- 2026-08-09 — Landed Domain 3 schema + RLS (`provider`, `credential`, `credential_verification_event`, `identity_verification`, `background_check`, `training_record`, `verified_profile`) plus the `credential_type` reference table (seeded per ADR-0001/CLAUDE.md's polymorphic-credential guardrail) in `supabase/migrations/20260809170000_domain3_provider_credentialing.sql`. Design deviates deliberately from the `packages/domain/src/credentialing.ts` placeholder in two ways, noted in the migration: dropped the redundant `provider.verifiedProfileId`/`verified_profile.providerId` double-pointer (kept only `verified_profile.provider_id`, unique not null), and dropped a duplicate `provider.role` column in favor of the existing `user.role_id` (enforced by a new `provider_enforce_role` trigger instead of risking drift between two role fields). All writes are staff-only ("manual-first" per the Phase 1 epic); a provider can read but not self-attest their own credentialing data — deliberately no self-service upload yet. No family-sponsor visibility into Domain 3 at all (the "Know Your Caregiver" trust card is Phase 2/LOCKED). Passes `rls:check` (17 tables). Verified against real local Postgres via `supabase db reset` + role-impersonation: `provider_enforce_role` correctly rejects onboarding a `family_sponsor` user as a provider; a nurse reads their own `provider`/`credential` rows but a direct self-attest `INSERT` into `credential` is correctly rejected by RLS; an unrelated second nurse sees zero rows of the first nurse's provider/credential data. Checked off the Phase 0 exit criterion "`credential_type` registry seeded." Not yet built (explicitly out of scope for this migration, tracked for later): the credential-expiry cron Edge Function that would auto-compute `verified_profile`'s booleans and auto-suspend scheduling eligibility on NMC PIN/AIN lapse — `verified_profile` is plain staff-writable booleans for now.
- 2026-08-09 — Retrofitted append-only `audit_log` + a generic `audit_row_change()` trigger onto all 17 Domain 1-3 tables (`supabase/migrations/20260809173000_domain9_audit_log.sql`) — scoped narrowly to this guardrail, **not** the rest of Domain 9 (`consent_record`, `dpc_registration`, `incident_report`, `data_retention_policy` remain unbuilt). Design: writes only (a row trigger can't fire on SELECT — auditing *read* access to health data is an open decision, not covered here); tamper-resistant by construction (`authenticated` has no INSERT/UPDATE/DELETE grant on `audit_log` at all — the trigger function is SECURITY DEFINER and is the only path in, even staff can't write directly). Passes `rls:check` (18 tables). Verified against real local Postgres via `supabase db reset` + role-impersonation: confirmed `old_data`/`new_data`/`actor_user_id` are captured correctly across a full INSERT→UPDATE→DELETE sequence on a real row; staff can read `audit_log`, a non-staff user sees zero rows; a direct `INSERT` into `audit_log` by a staff (coordinator) session fails with `permission denied for table audit_log`, proving tamper-resistance rather than just asserting it. Also caught up bookkeeping on already-true but previously-unchecked exit criteria: repo scaffold / `packages/db,domain,config` (pre-existing, verified still correct), and "no table without an RLS policy" (the `rls-coverage` CI check now enforces this for all 18 tables).
- 2026-08-09 — Landed the rest of Domain 9 (`consent_record`, `dpc_registration`, `incident_report`, `data_retention_policy` + RLS) in `supabase/migrations/20260809176000_domain9_compliance_records.sql`, with audit triggers attached from creation this time (no separate retrofit needed going forward). `dpc_registration.status` seeded as `'pending'`, matching the real, still-open "DPC controller registration status" question below rather than a placeholder `'active'`. `incident_report` explicitly does NOT implement escalation/routing-to-clinical-director — that's a future escalation-engine story. Passes `rls:check` (22 tables). Verified against real local Postgres: staff can write, a linked family sponsor can read `consent_record` for their own client but sees zero rows of `dpc_registration`/`incident_report`/`data_retention_policy` (fully staff-only, no sponsor path), and a sponsor's direct `INSERT` into `consent_record` is correctly rejected by RLS.
- 2026-08-09 — Wrote `supabase/seed.sql` (Supabase CLI's fixed seed-file convention, auto-applied by `supabase db reset`) with realistic-but-synthetic Ghanaian pilot-scale fixtures: 16 users across all 6 roles, 5 client-families, 6 sponsors (one client has two, exercising `decision_maker_hierarchy` priority ordering), 6 providers with deliberately mixed credential states (fully verified, mid-onboarding/pending, and one EXPIRED NMC PIN/AIN 15 days past expiry — a realistic case for the future credential-expiry cron), 1 incident_report, 1 dpc_registration. Hit and fixed a real Postgres gotcha along the way: literal uuid strings inside `UNION ALL` branches resolve to `text`, and `text -> uuid` is not an implicit/assignment cast for `INSERT ... SELECT` (unlike plain `INSERT ... VALUES`) — fixed with explicit `::uuid` casts, documented inline in the SQL. Deliberately encoded the "linked but not consented" guardrail case directly into the seed data (client 3's secondary sponsor has a family link but no `clinical_detail` consent_grant) rather than only covering it in ad hoc tests. Verified idempotency for real: re-ran `seed.sql` against an already-seeded database (not just a fresh `db reset`) and confirmed every insert reports 0 new rows. Verified the RLS behavior against the seeded data itself (not synthetic test-only users): the under-consented sponsor sees `client`/`emergency_contact` but zero `care_plan` rows; the fully-consented sponsor on the same client sees the care plan. Rewrote `packages/db/seed/run.mjs` (previously an unimplemented stub referencing a `@supabase/supabase-js` path that was never built) to shell out to `supabase db reset` — actually ran it via `node packages/db/seed/run.mjs` and confirmed it works end-to-end. Updated `packages/db/README.md`'s seed-data section to match. Also closed the one gap found against architecture brief Part 4's scaffolding spec: added `.env.example` (Supabase/WhatsApp/Paystack/Stripe/KYC-vendor variable names, no real values, already covered by `.gitignore`).
- 2026-08-09 — Phase 0 status check: every checklist item and exit criterion is now checked **except** two genuine external blockers, neither fixable from inside this repo: (1) an actual hosted Supabase project (EU region) hasn't been provisioned — everything so far is local-only; (2) CI has never run green because it's never run at all — `git push` to `origin` fails with `403` / "Your account is suspended" on the `tx3805843` GitHub account (confirmed githubstatus.com shows no outage — this is account-specific). Until that's resolved, nothing in `.github/workflows/` has actually executed against real GitHub Actions infrastructure; treat "CI pipeline" above as "written and locally-equivalent-tested," not "proven green in CI."
- 2026-08-09 — GitHub account `tx3805843` suspension lifted. Created initial commit `de149d9` (94 files, full Phase 0 scaffold + schema + seed) and pushed to `origin/main` for the first time — succeeded. This is the first time `.github/workflows/` CI actually runs on real GitHub infrastructure; next session must check the Actions tab and check off "CI green (lint, typecheck, migration dry-run)" once confirmed, or fix and re-push if it fails. Remaining Phase 0 blocker: hosted Supabase project (EU region) still not provisioned.

---

## Phase 1 — Ops MVP: "WhatsApp + Console" — **LOCKED until Phase 0 exit criteria are checked**

**Target:** Weeks 3-10

### Exit criteria (must all be true before Phase 2 unlocks)
- [ ] Visit completion rate, late/missed-visit rate, incident rate, staff retention, MRR, and referral rate are all measurable from the console — no spreadsheet required
- [ ] WhatsApp templates approved by Meta Business Manager and live in production
- [ ] At least one full pilot-family cycle (onboarding → scheduled visits → visit logging → family notification → payment) completed end-to-end without a manual workaround

### Checklist (epics — expand into stories at phase kickoff per architecture brief Part 5)
- [ ] Epic: Coordinator console (client onboarding, care plan, visit scheduling, manual visit logging, exception queue)
- [ ] Epic: WhatsApp family communication (visit summaries, escalation alerts, template library)
- [ ] Epic: Provider onboarding & credentialing, manual-first (credential upload/logging, 30-day expiry flagging)
- [ ] Epic: Payments Phase 1 minimum (Paystack GHS link, Stripe USD/GBP/EUR link)

### Changelog
_(none yet — phase not started)_

---

## Phase 2 — Native Field App & Family Self-Service — **LOCKED**

**Target:** Weeks 8-20 | Full story breakdown at Phase 1 exit review

- [ ] Epic: Offline-first field app (PowerSync sync, offline check-in/visit notes, escalation button)
- [ ] Epic: Family portal (self-service dashboard, multi-relative consent-scoped access)
- [ ] Epic: "Know Your Caregiver" trust experience (pre-visit trust card, live en-route status, safety button)
- [ ] Epic: Two-sided rating (`visit_rating`, `service_rating`, household/safety report)
- [ ] Epic: USSD/SMS fallback for critical alerts

---

## Phase 3 — Care Coordination & Provider Network — **LOCKED**

**Target:** Weeks 18-30 | Full story breakdown at Phase 2 exit review

- [ ] Epic: Care coordination workflows (appointment booking, transport/escort logging, provider network CRM)
- [ ] Epic: Financial controls (prepaid wallet, expense-approval thresholds)
- [ ] Epic: Quality dashboard (zone-level visit completion, incident rate, retention trends)

---

## Phase 4 — Scale & Production Hardening — **LOCKED**

**Target:** Weeks 28-40+ | Full story breakdown at Phase 3 exit review

- [ ] Epic: Multi-zone expansion (configurable zones, routing, pricing surcharge rules)
- [ ] Epic: Regulatory hardening (Transfer Impact Assessment package, af-south-1 migration runbook tested)
- [ ] Epic: Production non-functionals (load testing, backup/restore drill, penetration test, incident-response runbook)

---

## Open questions / decisions pending (park here, don't let them block a session)

- [ ] KYC vendor decision: Smile ID vs. Youverify — confirm current Ghana coverage/pricing
- [ ] DataFlow Group PSV engagement for NMC verification — commercially viable at pilot scale, or manual portal checks sufficient for 10-20 families?
- [ ] HeFRA exact licensing category confirmation (call logged? outcome?)
- [ ] DPC controller registration status
- [ ] Staff invite flow (assigning a non-`family_sponsor` role at signup, e.g. coordinator/nurse) — the Domain 1 migration's `handle_new_auth_user` trigger defaults every new signup to `family_sponsor` unless `role_id` is passed in `raw_user_meta_data`; nothing sets that yet. Needed before Phase 1 coordinator console can onboard real staff.
- [ ] `client.zone_id` is an unconstrained `uuid` (Domain 4 `zone` table doesn't exist — Domain 4 is Phase 1/Scheduling scope, not Phase 0). Add the FK constraint when Domain 4 lands; tracked here so it isn't forgotten since it won't be caught by the Phase 0 exit criteria.
- [ ] **Blocker:** no hosted Supabase project has been provisioned yet (EU region, per ADR-0003) — every migration/RLS-policy verification this session was against a local `supabase start` stack only. Phase 0's "Supabase project provisioned" exit criterion can't be checked until this happens; needs a Supabase account/org, not something an agent can do unattended.
- [x] **Resolved 2026-08-09:** GitHub account `tx3805843` no longer suspended. Initial commit (`de149d9`, 94 files) pushed to `origin/main` successfully. `.github/workflows/` CI will now run for real on this push — check Actions tab to confirm green before marking the "CI green" exit criterion complete.
