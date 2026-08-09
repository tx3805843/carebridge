# CareBridge — Agent Working Instructions

Nurse-led, WhatsApp-first home-care coordination platform for elderly clients in Ghana,
serving diaspora and local family sponsors. This file is the durable operating manual for
any agent working in this repo. It handles **health data and family money** — the cost of a
subtle wrong answer here is a data breach or a compliance failure, not a bug ticket. Work
accordingly.

## Progress tracking — the session ritual (do this, every session)

This project separates **why** (stable) from **what's next** (changes every session):

- **`carebridge-roadmap.md`** is the single source of truth for progress. It is a living
  file with per-phase checklists, exit criteria, and a changelog.
- **`carebridge-architecture-and-build-prompt.md`** is the stable design brief. Read it
  only for *why* (schema shape, RLS approach, credentialing rules) — never for *what's next*.

**Every session:**
1. **Read `carebridge-roadmap.md` FIRST**, before touching code or the brief. It tells you
   the current phase, what's checked off, and what's in scope.
2. Work **only inside the current phase's checklist**. Do not touch a locked phase.
3. **Update `carebridge-roadmap.md` LAST**: check off completed items, add a one-line dated
   changelog entry, and record any newly-discovered stories under the right epic (don't
   silently expand scope). Finishing work without updating this file leaves the next session
   blind.
4. Land each completed story as a commit that references the roadmap item it closes — git
   history is the secondary source of truth.

> The roadmap says "move to `docs/ROADMAP.md` once scaffolded." The repo is now scaffolded;
> if/when you move it, update the path in this file too.

## Phase gate — do not cross it

Current phase: **Phase 0 → Phase 1 (Ops MVP: WhatsApp + console only)**.

**The phase gate governs the software/app build track only.** It sequences *what code gets
written*, not the whole company. Non-app operational workstreams run on a **parallel track**
and are **not** blocked by the app phase gate — several are meant to start early. These
include: DPC controller registration, HeFRA licensing, KYC vendor selection (Smile ID vs.
Youverify), DataFlow PSV engagement for NMC verification, and **Meta Business Manager
verification + WhatsApp template approval** (start this in Phase 0 — approval lead time is
unpredictable and it otherwise stalls Phase 1). These are tracked in the roadmap's Phase 0
exit criteria and "Open questions / decisions pending" section; progress them independently.

The gate that *is* firm, on the app/code track:

- **Do NOT build the `field-app` or `family-portal`**, or wire PowerSync offline sync, until
  Phase 1 is explicitly marked complete in the roadmap. This is an intentional scope gate,
  not an oversight. Those app folders exist as scaffolding only.
- A phase unlocks only when the prior phase's **exit criteria** in the roadmap are all
  checked. If Phase 2 *app* work looks tempting, **stop and ask** — do not get a head start.

## Non-negotiable guardrails

These are correctness/compliance invariants, not style preferences. Never violate them, even
in a first draft.

- **Every table** has `created_at` / `updated_at` / `created_by` **and an explicit RLS
  policy**. No table ships without a policy — enforced by a CI RLS-coverage check, not manual
  review.
- **RLS resolves through `consent_grant`, not role alone.** A family sponsor with a role
  still needs an explicit consent grant to read clinical detail. See `packages/db/README.md`.
- **Audit logging is via Postgres triggers into an append-only `audit_log`** — never rely on
  application code to log access to health data.
- **Credentials are one polymorphic subsystem** driven by a `credential_type` reference table
  (Ghana Card, NMC PIN/AIN, police report, references, CPD/training). Never create ad-hoc
  tables per document type. See ADR-0001, brief Part 3.1.
- **Credential expiry is enforced by a cron Edge Function**, not a UI reminder. NMC PIN/AIN
  expire every 12 months: flag within 30 days, **auto-suspend scheduling eligibility on
  lapse**.
- **Ratings are trust signals, not a marketplace.** Shown only to the assigned family
  ("4.9, 32 visits"); under 5 visits show "New to this household". Never a public
  cross-provider directory, never drives algorithmic reassignment. `visit_rating` (two-sided)
  and `service_rating` (CareBridge-level) are distinct entities — don't conflate them.
  Safeguarding complaints are `incident_report` routed to the clinical director, **never**
  averaged into a rating.
- **`live_visit_tracking` is foreground-only**, scoped to the active scheduled visit window;
  its raw location trail is **purged on visit completion**, retaining only arrival/departure
  timestamps and zone. Never build continuous background staff tracking. Enforce in
  schema/retention job, not just policy.
- **Never develop against real client PII.** Use realistic-but-synthetic Ghanaian seed data
  (`packages/db/seed/`).
- **Every non-trivial architectural decision gets a short ADR** in `docs/adr/`.

## Supervisor–worker discipline (brief Part 7)

Some work is **supervisor-tier only** — author or *fully review* (not spot-check) with the
highest-capability model. Never delegate a first draft to a cheaper model:

- Schema design, RLS policy authorship, consent/access model
- Credential-expiry / auto-suspension logic
- Financial logic (invoicing, prepaid wallet, expense-approval thresholds)
- Audit-log trigger design and the credentialing/compliance subsystem
- Escalation and alert-routing logic (a missed escalation is a safety incident)

**Worker-tier** (delegate, but review any diff touching a schema or security boundary before
merge): CRUD scaffolding for an already-designed table, UI components against the established
shadcn/ui pattern, tests against a written spec, seed data, WhatsApp template drafts, docs.

If a worker gets a task wrong twice, escalate — don't re-prompt a third time.

## Commands

```bash
pnpm install                      # install (use --frozen-lockfile in CI)
pnpm dev                          # run all apps via turbo
pnpm build | lint | typecheck | test   # turbo pipelines (each app/package implements its own)

supabase start                    # local Postgres + Edge Functions (needs Supabase CLI)
pnpm --filter @carebridge/db migrate:new     # scaffold a timestamped migration
pnpm --filter @carebridge/db migrate:dry-run # required before any migration merges
pnpm --filter @carebridge/db types:generate  # regen packages/domain/src/generated.ts from live schema
```

CI (GitHub Actions) runs: **lint, typecheck, test, migration-dry-run** (and an RLS-coverage
check). `deploy.yml` pushes migrations + edge functions. Migrations must pass the dry-run.

## Repo map

```
apps/
  ops-console/    Next.js (App Router, TS) — coordinator/clinical-director console  [Phase 1]
  family-portal/  Next.js — family dashboard                                        [Phase 2 — do not build yet]
  field-app/      Expo/React Native, offline-first via PowerSync                    [Phase 2 — do not build yet]
packages/
  db/             Supabase migration wrappers, RLS policy docs (rls/), seed data
  domain/         Shared TS domain types — 10 bounded domains, see docs/domain-model.md
  ui/             shadcn/ui-based shared components
  whatsapp/       WhatsApp Cloud API client + message templates
  config/         Shared eslint / tsconfig / tailwind presets
supabase/
  migrations/     SQL migrations (Supabase CLI managed — canonical DDL location)
  functions/      Edge Functions: escalation-engine, credential-expiry-cron,
                  whatsapp-webhook, invoice-generator
docs/
  adr/            Architecture Decision Records — one per material decision
  domain-model.md 10 bounded domains → packages/domain/src/ mapping
  compliance/     DPC registration record, HeFRA licensing evidence index
```

Domain types in `packages/domain/src/` are hand-written placeholders today; after real DDL
lands in `supabase/migrations/`, regenerate with `types:generate` and retire the hand-written
versions module by module. Keep `docs/domain-model.md` in sync as migrations land.

## Stack

Supabase (Postgres + RLS + Auth + Storage + Realtime + Edge Functions) · Next.js on Vercel ·
Expo/React Native + PowerSync · WhatsApp Business Cloud API · Paystack (GHS) + Stripe
(diaspora currencies) · pnpm workspaces + Turborepo · Node ≥ 20, pnpm 9.7. Rationale for each
choice is in the brief, Part 1.
