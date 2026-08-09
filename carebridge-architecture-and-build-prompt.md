# CareBridge — Solutions Architecture Brief & Vibe-Coding Build Prompt

**Prepared by:** Lead Solutions Architect (AI-assisted draft)
**For:** Peekay — Founder
**Date:** 2026-08-09
**Source:** `carebridge1.md` (refined business concept, Aug 2026)
**Status:** Draft for review — pressure-test before committing engineering budget

---

## Part 0 — Architect's Position (read this before you build anything)

Three calls, stated plainly, because the business doc leaves them open and they drive every downstream decision:

1. **Clinical boundary at launch:** Launch nurse-led, not companion-only, but keep the clinical scope narrow — vitals, medication reconciliation, chronic-disease monitoring, basic wound/post-op care within protocol. HeFRA's domiciliary nursing category requires only two registered nurses with 5+ years' post-qualification experience in good standing with the Nursing and Midwifery Council (NMC) — that's achievable in your 90-day window and it's the trust differentiator that justifies premium diaspora pricing. Pure companion-care-first is slower to differentiate and undersells the "nurse-led" positioning you already wrote into the value prop. Full hospital-adjacent clinical services (invasive procedures, complex wound care) stay out of scope until you have volume and a stronger clinical governance bench.
2. **No app-first MVP.** The business doc is right: Phase 1 is WhatsApp + a coordinator console + digital forms + payment links. Do not let a vibe-coding session run away and build a polished consumer app before you've validated visit-completion rates and staff reliability with 10-20 pilot families. Native apps come in Phase 2, funded by what Phase 1 actually teaches you about which alerts and workflows families use.
3. **Data residency is not optional, it's coming.** Ghana's Data Protection Act, 2012 (Act 843) already requires Data Protection Commission (DPC) registration for any controller processing personal data, with tighter obligations for "special personal data" (health status is explicitly named). The Data Protection Bill, 2025 — currently moving through Parliament — adds mandatory localization for health records and biometric data, plus Transfer Impact Assessments for cross-border transfers. You are a diaspora-serving business built on cross-border data flow by design. Architect for localization now (schema isolation, encryption, portable hosting) rather than re-platforming under regulatory deadline pressure in 12-18 months.

Everything below assumes these three decisions. If you disagree with any of them, say so before you hand this to a coding agent — they change the domain model and the phasing.

---

## Part 1 — Technology Stack Recommendation

### 1.1 Stack decision table

| Layer | Recommendation | Why | Rejected alternative |
|---|---|---|---|
| System of record | **PostgreSQL via Supabase** (managed, self-hostable later) | Native Row-Level Security maps directly onto your consent/family-visibility model; built-in Auth, Storage, Realtime, and Edge Functions cover 80% of Phase 1-2 backend needs without a bespoke services layer; open-source core means you can self-host if/when Ghana data-residency rules force a migration off Supabase's managed regions | Firebase/Firestore — weak relational integrity and RLS is bolted-on, poor fit for a clinical audit-trail domain model |
| Family portal + Ops console | **Next.js (TypeScript, App Router)** on Vercel | Server-rendered pages perform acceptably on constrained Ghanaian mobile data; one framework serves both portal and internal console; largest ecosystem for AI-assisted coding tools to reason about correctly | Plain SPA (Vite/React) — no SSR, worse first-load on poor connections |
| Caregiver/Nurse field app | **React Native + Expo**, offline-first via **PowerSync** synced to the same Postgres instance | Business doc mandates "lightweight Android-first, offline capture, later sync" — this is PowerSync's exact design target (non-invasive sync layer over Postgres/Supabase, conflict-aware write queue, works disconnected). Expo gets you iOS later at near-zero incremental cost when families abroad want to verify via an iPhone | Native Kotlin — faster/lighter but doubles engineering cost for no launch-relevant benefit; WatermelonDB — viable fallback if PowerSync pricing doesn't work at your scale, but more custom sync code to own |
| Family communication | **WhatsApp Business Platform (Cloud API)**, via Meta directly or a BSP (Twilio/360dialog) | Explicit requirement — WhatsApp is the primary channel, not a novelty integration | Building a custom notification center as the primary channel — families won't adopt it before trust is established |
| SMS/USSD fallback | **Africa's Talking** (or Hubtel as a Ghana-based alternative) | Established Ghana/West Africa SMS and USSD gateway; standard vendor choice for Ghanaian fintech/health products | Twilio SMS alone — works for SMS, no USSD story for Ghana |
| Payments | **Paystack** (Ghana-licensed, GHS) + **Stripe** (USD/GBP/EUR diaspora billing) | Paystack has direct Ghana mobile money and GHS card rails; Stripe is the reliable diaspora-currency processor; run them side by side rather than forcing one processor to do both | Hubtel Payments alone — solid for GHS/mobile money, weak for multi-currency diaspora billing |
| Identity verification (KYC) | **Smile ID** or **Youverify** for Ghana Card (NIA) verification — evaluate both, confirm current Ghana coverage and pricing before committing | Purpose-built African identity-verification APIs with Ghana Card support; avoids building document-OCR/liveness yourself | Manual-only ID checks — acceptable stopgap for the pilot, not for scale |
| Professional license verification | **NMC Ghana's License Renewal & Revalidation Portal** for manual PIN/AIN checks at hire and revalidation; evaluate a **DataFlow Group** primary-source-verification engagement (DataFlow already runs NMC Ghana's digital credential-verification partnership) for an automated path | Confirmed, purpose-built channel — don't build a scraper against the NMC portal | Self-attested credentials with no third-party check — unacceptable given your trust positioning |
| Background/police check | Manual document custody (Ghana Police Service certificate of good conduct) with mandatory expiry tracking — no confirmed automated Ghana background-check API exists at time of writing; validate before assuming one | This is the honest gap: flag it as a manual, audited process, not an API integration | Assuming an automated background-check vendor exists for Ghana — unconfirmed, do not build against it |
| Hosting/region | Supabase-managed **EU West (London)** for launch (closest available managed region with acceptable latency to Accra); design schema so health/biometric tables can be extracted to a **self-hosted Postgres in AWS af-south-1 (Cape Town)** or a Ghana-based provider without a full re-platform | Supabase does not currently offer an African region for managed projects (confirmed) — af-south-1 exists as raw AWS infrastructure and is the nearest real option if/when the Data Protection Bill mandates localization | Waiting to decide hosting later — this is a schema-design decision, must be made in Phase 0 |
| Observability | **Sentry** (errors), **Better Stack** or **Axiom** (logs), Postgres audit triggers → append-only `audit_log` table | Lightweight, AI-agent-friendly to wire up, and the audit log is a compliance requirement, not a nice-to-have | Rolling your own log pipeline pre-launch — wasted effort at this stage |
| CI/CD | GitHub Actions → Vercel (web) + EAS Build (Expo) + Supabase CLI migrations | Standard, well-documented paths that coding agents handle reliably | — |

### 1.2 What "5-star" actually requires here

A 5-star rating in this category is won or lost on trust signals, not UI polish: visit reliability, verified-provider transparency, fast escalation response, and families never feeling like they're guessing. Prioritize engineering effort accordingly — the exception queue, escalation alerting, and credential-verification workflow matter more to your App Store rating than animation quality on the family dashboard.

---

## Part 2 — Canonical Domain Model

Ten bounded domains. This extends the business doc's own canonical list (client, family sponsor, consent, care plan, visit, observation, task, incident, provider, invoice, escalation) with the two domains you specifically flagged as missing: **provider trust/credentialing** and **rating/feedback**.

| # | Domain | Core entities | Notes |
|---|---|---|---|
| 1 | Identity & Access | `user`, `role`, `family_sponsor`, `client_relationship`, `consent_grant` | Every access check resolves through `consent_grant`, not just role — a relative with a role still needs an explicit consent grant to see clinical detail |
| 2 | Client & Care Plan | `client`, `care_plan`, `emergency_contact`, `decision_maker_hierarchy` | Encodes the "who decides, who's informed, who pays" model the business doc requires at onboarding |
| 3 | **Provider & Credentialing** | `provider`, `credential`, `credential_verification_event`, `identity_verification`, `background_check`, `training_record`, `verified_profile` | Section 3 below is the deep dive |
| 4 | Scheduling & Visit Ops | `roster`, `zone`, `visit`, `visit_checkin`, `observation`, `task` | Offline-first; visit is the atomic unit of trust |
| 5 | **Trust, Rating & Feedback** | `visit_rating` (two-sided), `service_rating`, `live_visit_tracking`, `provider_quality_score`, `complaint`, `safeguarding_case` | Section 3 below |
| 6 | Care Coordination | `appointment`, `referral`, `transport_booking`, `pharmacy_order`, `provider_network_partner` | The business doc's own "most valuable differentiator" |
| 7 | Communications & Alerts | `notification`, `whatsapp_message_log`, `escalation`, `alert_rule` | Escalation is first-class, not a notification subtype |
| 8 | Billing & Financial Controls | `subscription`, `invoice`, `prepaid_wallet`, `expense_approval`, `payment` | Separates care fees from approved third-party spend, per the business doc |
| 9 | Compliance & Audit | `consent_record`, `dpc_registration`, `audit_log`, `incident_report`, `data_retention_policy` | Append-only audit log spans every domain |
| 10 | Analytics & Quality | `kpi_snapshot`, `zone_performance`, `retention_metric` | Feeds the ops dashboard the business doc's Months 4-12 plan calls for |

---

## Part 3 — Provider Trust & Credentialing, and the Rating Model (your specific question)

### 3.1 What gets captured, verified, and retained per provider

| Item | Capture at | Verification method | Retention / revalidation |
|---|---|---|---|
| Ghana Card (national ID) | Onboarding | Automated via KYC vendor (Smile ID / Youverify) — document + liveness check | Retained for employment duration + statutory period post-exit; revalidate if expired |
| NMC registration (PIN/AIN) | Onboarding, RNs and enrolled nurses only | Manual lookup against NMC's License Renewal & Revalidation Portal at hire; DataFlow Group PSV engagement if automated verification is commercially viable | **PIN/AIN expires every 12 months** — this is a hard architectural requirement: `credential.expiry_date` drives a mandatory re-verification workflow, and an expired PIN must auto-suspend the provider from scheduling until cleared |
| Police report / certificate of good conduct | Onboarding | Manual document upload, custody, and officer-of-record sign-off — no confirmed automated API for Ghana; treat as document-of-record with expiry tracking (recommend 12-24 month refresh cycle, confirm with counsel) | Encrypted storage, access restricted to clinical director/HR role only, audit-logged on every view |
| Reference checks | Onboarding | Manual, structured reference-check form logged as a `credential_verification_event` | Retained indefinitely as part of hiring record |
| CPD points / continuing education | Ongoing | Self-reported + spot-audited, tied to NMC revalidation cycle | Tracked as `training_record`, feeds the same 12-month expiry workflow as NMC PIN |
| Scope-of-practice attestation | Onboarding + on role change | Signed by clinical director | Version-controlled; every visit type is checked against the provider's current attested scope before scheduling allows it |
| Photo, years of experience, specializations | Onboarding | Self-reported, photo verified against Ghana Card during KYC | Powers the family-facing Verified Profile |

**Architectural point:** every row above is a `credential` with a type, an issuing authority, a verification status (`unverified` / `pending` / `verified` / `expired` / `rejected`), an expiry date, and an evidence document reference. Do not model police reports, NMC licenses, and training records as separate ad-hoc tables — one polymorphic credentialing subsystem, driven by a `credential_type` reference table, so adding a new document type later (e.g., a driving license for staff who transport clients) doesn't require a schema migration.

### 3.2 The "Know Your Caregiver" trust experience (Uber-equivalent, purpose-built for this domain)

The Uber analogy is the right mental model for the family-side experience — a family sponsor abroad has exactly the same need a rider's parent has when tracking a car: "who is this person, are they really who they say, and are they actually on the way." Build it as three moments, same as Uber structures a trip:

**Before the visit — the trust card** (portal + WhatsApp message sent when a visit is scheduled/confirmed):
- Photo, full name, role (RN / enrolled nurse / caregiver), years of experience, and how long this specific person has supported this client
- Verification badges: ID Verified, NMC Licensed (status, not raw PIN), Background Checked, Training Current — badges and a visible rating (see 3.3), never raw credential documents; the family never sees the police report itself
- Scheduled arrival window

**During the visit — live status**, sent when the caregiver checks in as "en route" from the field app:
- "[Name] is on the way — arriving by [time]" with a live location ping (foreground-only, tied to the active scheduled visit, not continuous background tracking) and a shareable link, the direct equivalent of Uber's "share my trip" for a family member watching from abroad
- Automatic "[Name] has arrived" / "visit in progress" / "visit complete" status updates
- A visible in-app **safety/concern button** on the live-status screen itself, reachable by the family during the visit — not buried three menus deep, mirroring Uber's safety toolkit being on the trip screen, not the settings screen

**After the visit** — visit summary (already specced in Part 5) plus the rating prompt described in 3.3.

**Privacy/labor constraint on live tracking, stated explicitly so it doesn't get built as a surveillance feature by accident:** location is captured only during the active, scheduled visit-transit window that the caregiver has opted into as a condition of employment (disclosed in the employment contract, not an app permission buried in onboarding). Store only visit-level arrival/departure timestamps and zone after the visit closes — purge the raw location trail once the visit is marked complete. Ghana's Data Protection Act 2012 treats employee location data as personal data subject to the same purpose-limitation and security principles as client health data; do not let this become a persistent staff-movement dataset.

### 3.3 Two-sided rating: the caregiver, and CareBridge itself

You're right that there are two separate things worth rating, and the business doc's own success metrics (satisfaction, referral rate) already assume you're measuring both — the schema should say so explicitly.

**Caregiver rating (`visit_rating`) — per visit, family → caregiver:**
- 1-5 stars plus optional quick tags ("On time," "Professional," "Great with Mum," "Clear communication") and an optional comment — richer signal than a thumbs-up/down, low friction to complete
- **Visible to the assigned family as a real number**, not a suppressed badge — e.g., "4.9 (32 visits)" on the trust card. Correction from my first draft: hiding the number wasn't protecting anything, because families never browse a directory of caregivers to shop between — they only ever see the person assigned to them. The safeguard is scoping (never a public cross-platform directory), not obscuring the digits.
- **"New to this household" state instead of a number below n = 5** for that specific client relationship — the same pattern Uber uses for new drivers — so one early visit can't define someone before there's a track record.
- Feeds the internal `provider_quality_score` (rolled up with on-time rate, incident count, supervisor spot-checks) used for coaching, staffing, and retention/career-progression decisions — this is where I'd still stop short of Uber: **rating never drives algorithmic reassignment or dispatch.** Continuity of care is the product; a coordinator/clinical director decides on reassignment, informed by the score, not an algorithm optimizing for rating.

**Household/safety report (`visit_rating`, reverse direction) — caregiver → household, after each visit:**
- The two-sided half of the Uber model: caregiver flags access issues, household safety concerns, or conduct concerns after a visit. This is a genuine retention lever (the business doc names staff reliability and safety as top risks) and gives HR an early signal before a good caregiver quietly quits over an unsafe household.

**CareBridge relationship rating (`service_rating`) — separate from any single visit:**
- A periodic (e.g., monthly, or at renewal) "how is CareBridge doing" prompt to the family sponsor — this is your NPS/CSAT number, rolls up to the leadership quality dashboard in Phase 3, and is what you'd actually put in diaspora-facing marketing ("families rate us X/5"), as distinct from any individual caregiver's score.

**What stays separate from all of the above, unchanged from my original recommendation:** a safeguarding complaint is modeled as `incident_report`, routes immediately to the clinical director, and is never averaged into a star rating. Conflating "I didn't like the visit" with "I have a safety concern" is one of the more legitimate criticisms of Uber's own rating system — don't import that flaw.

### 3.4 Ghana regulatory grounding for this domain

- **HeFRA** (Health Facilities Regulatory Agency, under the Health Institutions and Facilities Act, 2011 / Act 829) licenses the facility/service; domiciliary nursing services specifically require at least two registered nurses/midwives with 5+ years' post-qualification experience, in good standing with NMC — confirm your exact category and inspection requirements directly with HeFRA (0302 900 995 / info@hefra.gov.gh) before launch; this is a licensing action item, not an engineering one, but the credentialing subsystem must be able to produce the evidence HeFRA's inspection will ask for.
- **NMC Ghana** regulates nurse/midwife registration and practice; PIN/AIN credentials expire every 12 calendar months and renew against CPD points — build the expiry-driven suspension workflow described above.
- **Data Protection Act, 2012 (Act 843)**: register as a data controller with the Data Protection Commission before processing begins; health status is explicitly "special personal data" requiring a stricter lawful basis (consent, generally) and heightened security obligations.
- **Data Protection Bill, 2025** (in progress through Parliament as of mid-2026): introduces mandatory localization for health records, biometric data, and national-identity-linked data, plus Transfer Impact Assessments for cross-border transfers and Authority pre-approval in some cases. Because your core product is cross-border family visibility into health data, build the consent-and-transfer-logging model now so a Transfer Impact Assessment is a paperwork exercise later, not a re-architecture.
- Get Ghana-qualified healthcare and data-protection counsel engaged before Phase 1 goes live with real client data — this document is architecture guidance, not legal advice, and the regulatory picture (especially the 2025 Bill) is actively moving.

---

## Part 4 — Project Scaffolding (initial repo structure)

Monorepo, pnpm workspaces, TypeScript everywhere it can reasonably go.

```
carebridge/
├── apps/
│   ├── ops-console/          # Next.js — internal coordinator/clinical-director console (Phase 1)
│   ├── family-portal/        # Next.js — family-facing dashboard (Phase 2)
│   └── field-app/            # Expo/React Native — caregiver/nurse offline-first app (Phase 2)
├── packages/
│   ├── db/                   # Supabase migrations, RLS policies, seed data
│   ├── domain/                # Shared TypeScript domain types (generated from Postgres schema)
│   ├── ui/                    # Shared component library (shadcn/ui-based) for web apps
│   ├── whatsapp/               # WhatsApp Cloud API client + message templates
│   └── config/                 # Shared eslint/tsconfig/tailwind config
├── supabase/
│   ├── functions/              # Edge Functions: escalation-engine, credential-expiry-cron,
│   │                           #   whatsapp-webhook, invoice-generator
│   └── migrations/
├── docs/
│   ├── adr/                    # Architecture Decision Records — one per material decision
│   ├── domain-model.md
│   └── compliance/              # DPC registration record, HeFRA licensing evidence index
├── .github/workflows/           # CI: lint, typecheck, test, migration-dry-run, deploy
├── turbo.json
├── pnpm-workspace.yaml
└── README.md
```

**Best-practice guardrails to bake in from commit one**, not retrofit later:
- Every table gets `created_at`, `updated_at`, `created_by`, and an RLS policy — no table ships without one.
- `audit_log` is populated via Postgres triggers, not application code, so it can't be bypassed by a bug.
- Environment secrets (WhatsApp tokens, KYC vendor keys, payment processor keys) live in Supabase/Vercel secret stores, never in `.env` committed to the repo — set up `.env.example` only.
- One ADR per non-trivial decision (e.g., "why Supabase over self-hosted Postgres at launch," "why EU region pending Ghana localization") — you already think in ADR/KAD terms; keep that discipline from day one so the eventual localization migration has a paper trail.
- Seed data scripts must generate realistic-but-fake Ghanaian addresses/names for local dev — don't develop against production-shaped data with real PII, ever.

---

## Part 5 — Phased Development Roadmap: Epics, Features, User Stories

Phasing mirrors the business doc's own pilot plan (First 90 Days / Months 4-12), translated into engineering delivery. Phase 1 gets full story-level detail because that's what a coding agent should actually start building; Phases 2-4 are epic/feature-level with representative stories — elaborate the rest at each phase kickoff rather than speculatively now.

### Phase 0 — Foundations & Compliance Readiness (Weeks 1-4)

**Epic: Platform bootstrap**
- Feature: Supabase project provisioned (EU region), repo scaffolded per Part 4, CI green on an empty app.
- Feature: Core schema for domains 1, 2, 3, 9 (Identity, Client, Provider/Credentialing, Compliance) with RLS policies.
- Feature: Audit logging triggers live on every table before any real data is entered.

**Epic: Compliance scaffolding**
- Story: *As the clinical director, I need a `credential_type` registry seeded with Ghana Card, NMC PIN/AIN, police report, reference check, and CPD record, so onboarding can't skip a required check.*
  Acceptance: attempting to mark a provider "active" without all required credential types in `verified` status is blocked at the database level (check constraint or trigger), not just in the UI.
- Story: *As the founder, I need a DPC-registration evidence record in the compliance domain, so the business can demonstrate registration status on demand.*

### Phase 1 — Ops MVP: "WhatsApp + Console" (Weeks 3-10)

This is the business doc's explicit MVP: no consumer-facing app, WhatsApp as the channel, a coordinator console as the system of record.

**Epic: Coordinator console (ops-console app)**
- Story: *As a care coordinator, I can create a client record with care plan, decision-maker hierarchy, and emergency contacts, so onboarding is documented from day one.*
- Story: *As a care coordinator, I can schedule a visit against a provider and zone, so the roster reflects who's going where.*
- Story: *As a care coordinator, I can log a visit outcome (arrival time, tasks completed, observations, escalation flag) on behalf of a provider who reports in by phone, so service continues even when the field app doesn't exist yet.*
- Story: *As the clinical director, I can view the exception queue (late visits, missed check-ins, flagged observations), so nothing falls through during the pilot.*

**Epic: WhatsApp family communication**
- Story: *As a family sponsor, I receive a WhatsApp message after every visit summarizing what happened, so I don't need to log into anything.*
- Story: *As a family sponsor, I receive an immediate WhatsApp escalation alert if a visit is missed or an observation crosses a defined threshold, so I'm never the last to know.*
- Feature: WhatsApp template library approved through Meta Business Manager (visit summary, escalation, appointment reminder, invoice notice).

**Epic: Provider onboarding & credentialing (manual-first)**
- Story: *As HR, I can upload and log a provider's Ghana Card, NMC PIN/AIN, police report, and references against the credential registry from Phase 0, with expiry dates captured, so nothing is verified informally.*
- Story: *As the system, I automatically flag any provider whose NMC PIN is within 30 days of expiry, so revalidation happens before a lapse, not after.*

**Epic: Payments (Phase 1 minimum)**
- Story: *As a family sponsor, I receive a payment link (Paystack for GHS, Stripe for USD/GBP/EUR) for my subscription, so billing doesn't require a banking relationship with the company directly.*

**Phase 1 exit criteria** (borrowed directly from the business doc's own pilot metrics): visit completion rate, late/missed-visit rate, incident rate, staff retention, MRR, and referral rate are all measurable from the console without a spreadsheet.

### Phase 2 — Native Field App & Family Self-Service (Weeks 8-20)

**Epic: Offline-first field app (field-app)**
- Story: *As a caregiver/nurse, I can see my assigned schedule and navigate to each client, including when offline, so connectivity gaps don't stop my day.*
- Story: *As a caregiver/nurse, I can check in/out of a visit and complete a structured visit note offline, with automatic sync when connectivity returns via PowerSync, so no visit data is lost to a dead zone.*
- Story: *As a caregiver/nurse, I have a one-tap escalation button that reaches the clinical supervisor, so urgent concerns don't wait for the next scheduled call-in.*
- Feature: Credential/training status visible in-app so a provider knows if they're at risk of suspension before scheduling does it for them.

**Epic: Family portal (family-portal)**
- Story: *As a family sponsor, I can log in and see care plan, upcoming/completed visits, invoices, and the Verified Caregiver Profile for whoever is assigned, so I have self-service visibility beyond WhatsApp summaries.*
- Story: *As a family sponsor, I can grant a sibling view-only or full access to the client's record, so multi-relative visibility is explicit and consent-logged, not informal.*

**Epic: Trust & Rating (domain 5, live) — the "Know Your Caregiver" experience**
- Story: *As a family sponsor, I see a trust card (photo, credentials, badges, rating) when a visit is scheduled, so I know exactly who is coming before they arrive.*
- Story: *As a family sponsor, I get a live "on the way" status with ETA when the caregiver checks in as en route, and can reach a safety/concern button directly from that screen, so I have real-time visibility without needing to call anyone.*
- Story: *As a family sponsor, I can rate the visit (1-5 stars, quick tags, optional comment) afterward, and see the caregiver's rolling rating on future trust cards — shown as "New to this household" until there are 5+ visits with this client.*
- Story: *As a caregiver, I can flag a household/access/safety concern after a visit, so issues affecting my safety are captured with the same weight as a family's feedback about me.*
- Story: *As the clinical director, I receive periodic `service_rating` (CareBridge-level, not caregiver-level) results on the quality dashboard, distinct from individual caregiver ratings, so I can tell "we have a bad caregiver on this case" apart from "families are unhappy with CareBridge generally."*

**Epic: USSD/SMS fallback**
- Story: *As a family member without reliable data access, I can receive a critical escalation alert via SMS, so connectivity never blocks safety-relevant communication.*

### Phase 3 — Care Coordination & Provider Network (Weeks 18-30)

**Epic: Care coordination workflows**
- Story: *As a care coordinator, I can book a specialist appointment and log transport/escort arrangements against a client record, so hospital visits are tracked end-to-end.*
- Story: *As a care coordinator, I can manage a vetted network of hospitals, pharmacies, and ambulance partners with contact and SLA metadata, so provider coordination isn't tribal knowledge.*

**Epic: Financial controls**
- Story: *As a family sponsor, I can fund a prepaid wallet for approved pharmacy/medical expenses, so spend is pre-authorized and reconciled with receipts rather than disputed after the fact.*
- Story: *As a care coordinator, I must get sponsor approval above a configurable threshold before a third-party expense is logged as billable, so overspend disputes are structurally prevented.*

**Epic: Quality dashboard**
- Story: *As the clinical director, I can see zone-level visit completion, incident rate, and staff retention trends, so quality issues are visible before they become client complaints.*

### Phase 4 — Scale & Production Hardening (Weeks 28-40+)

**Epic: Multi-zone expansion**
- Story: *As an operations lead, I can activate a new zone with its own routing, staffing pool, and pricing surcharge rules, so expansion to Kumasi/Takoradi doesn't require a code change.*

**Epic: Regulatory hardening**
- Story: *As the compliance owner, I can produce a Transfer Impact Assessment package (data flows, safeguards, consent evidence) for any cross-border health-data transfer, so Data Protection Bill 2025 compliance is a report, not a scramble.*
- Feature: Migration runbook for extracting health/biometric tables to a self-hosted Postgres instance in AWS af-south-1 (Cape Town) or a Ghana-based provider, tested in a non-production environment even if not executed at launch.

**Epic: Production-grade non-functionals**
- Feature: Load testing against projected multi-zone visit volume; documented RTO/RPO with automated backups and a tested restore; penetration test before processing a material volume of client health data; formal incident-response runbook tied to the `incident_report` entity.

---

## Part 6 — Risks Specific to the Build (technical, not business)

| Risk | Mitigation |
|---|---|
| Building the native field app before Phase 1 proves the operating model | Hold the line on Phase 1 scope — WhatsApp + console only, no exceptions, regardless of how tempting it is to "just build the app" in a vibe-coding session |
| RLS policy gaps exposing one family's data to another | Every new table's RLS policy gets a written test case in CI before merge; no policy ships unreviewed |
| Credential expiry silently lapsing (NMC PIN, police report) | Expiry checks are a scheduled Edge Function (cron), not a UI reminder — the provider is auto-suspended from scheduling on lapse, not just flagged |
| Data residency decision deferred until forced by regulation | Schema isolation of special-category health/biometric data is a Phase 0 decision, documented in an ADR, not revisited under deadline pressure |
| WhatsApp template rejections stalling family communication | Get Meta Business Manager verification and template approval started in Phase 0, not Phase 1 — approval lead time is unpredictable |
| Treating this as a marketplace/rating product and undermining the managed-workforce trust model | Ratings stay scoped to the assigned family (never a public cross-provider directory) and never drive algorithmic reassignment — continuity decisions stay with the clinical director, informed by the score |
| Live location tracking drifting into continuous staff surveillance | `live_visit_tracking` is foreground-only, tied to an active scheduled visit, and purged to timestamps-only on visit completion — enforce this in the schema/retention job, not just policy |

---

## Part 7 — AI-Assisted Build Operating Model (Supervisor-Worker)

Standing instruction for this build: use a supervisor-worker pattern for AI-assisted coding — cheap/fast models do the well-specified, mechanical work; a high-capability model owns architecture, judgment calls, and review. The failure mode to avoid isn't "used an expensive model when a cheap one would do" — it's "let a cheap model make an unsupervised judgment call in a schema that handles health data and family money." Delegate aggressively where the task is narrow and the spec is tight; never delegate where correctness depends on holding the whole domain model in view.

### 7.1 Task classification

| Task type | Tier | Why |
|---|---|---|
| Schema design, RLS policy authorship, credential-expiry/suspension logic, consent-and-access model | **Supervisor only** | Wrong here is a data breach or a compliance failure, not a bug ticket — this is exactly the "detriment to output quality" case worth paying for |
| Financial logic (invoicing, prepaid wallet, expense-approval thresholds) | **Supervisor only** | Money math with ambiguous edge cases is where cheap models silently produce plausible-looking wrong answers |
| Audit-log trigger design, anything in the compliance/Part 3 credentialing subsystem | **Supervisor only** | This is the evidence you show HeFRA/DPC on demand — no tolerance for subtle errors |
| Escalation and alert-routing logic (who gets notified, under what threshold) | **Supervisor only** | A missed escalation is a safety incident, not a defect |
| CRUD scaffolding for an already-designed table/screen | **Worker** | Mechanical once the schema and pattern exist |
| UI components against the established shadcn/ui design system | **Worker** | Pattern-following, low judgment once 1-2 reference components exist |
| Test writing against a written spec/acceptance criteria | **Worker**, supervisor spot-checks coverage of edge cases | Cheap models write competent tests from a clear spec; they don't reliably invent the right edge cases unprompted |
| Seed/fixture data generation, i18n strings, WhatsApp template first drafts | **Worker** | Low blast radius, easy to review by inspection |
| Repetitive multi-file mechanical changes (e.g., apply a proven RLS pattern to 10 more tables) | **Worker**, supervisor reviews the diff | Do the first one as supervisor, delegate the repetition |
| Documentation, README, code comments | **Worker** | — |

### 7.2 Review discipline

Worker output in the "Supervisor only" domains above doesn't happen — don't assign it there in the first place. Worker output everywhere else still gets reviewed before merge, not spot-checked, for anything touching the schema or a security boundary; pure UI/docs/test output can be spot-checked. If a worker gets a task wrong twice, stop re-prompting it — that's a signal the task was mis-classified, not that the third prompt will land. Escalate to supervisor tier rather than burning further cycles on a model that structurally isn't going to get it right.

### 7.3 Mechanics

If you're building with Claude Code or the Claude Agent SDK, this maps directly onto subagents: define a lead/architect agent at full capability for everything in the "Supervisor only" row, and named worker subagents (scaffolding, test-writer, docs) pinned to a cheaper model for the rest, invoked with a tightly scoped, unambiguous work order — the narrower the spec, the better a cheap model performs, so the supervisor's real job is writing worker prompts precisely, not just picking which model runs them.

### 7.4 Model tiering (four tiers, cost-ascending)

| Tier | Model | Use for |
|---|---|---|
| Worker | Haiku 4.5 | Everything in the "Worker" row of 7.1 |
| Default supervisor | Sonnet 5 | Day-to-day architecture review, writing worker work orders, most of the "Supervisor only" row in normal operation |
| Escalation | Opus 4.8 | Genuinely hard problems Sonnet is struggling with — the standing "bump up a tier on second failure" rule from 7.2 |
| Reserved | Fable 5 | A small number of one-time, high-blast-radius passes: initial RLS/consent-model design, architecting the credentialing/audit subsystem, a pre-launch security review of the health-data path. Priced at roughly 2x Opus 4.8, so it's not the default supervisor — it's for the do-it-once-and-get-it-right work where paying more is cheap insurance, not the everyday tier |

Don't run Fable 5 as the standing supervisor — its cost only pays off on foundational, infrequent, high-consequence work. For everything that recurs (every new table, every new screen, every new worker task), Sonnet 5 reviewing worker output is the right economics; escalate to Opus 4.8 when Sonnet is genuinely stuck, and reserve Fable 5 for the handful of moments in this build where the cost of being wrong clearly outweighs 2x the token price.

---

## Part 8 — Vibe-Coding Build Prompt (copy this block into your coding agent)

```
You are the lead engineer building CareBridge, a nurse-led home-care coordination
platform for elderly clients in Ghana, serving diaspora and local family sponsors.

Non-negotiable constraints:
- Monorepo: pnpm workspaces + Turborepo, per the structure in docs/architecture/scaffolding.md
- Backend: Postgres via Supabase (Auth, Storage, Edge Functions, Realtime). Every table
  must have created_at/updated_at/created_by and an explicit RLS policy — no table ships
  without one, no exceptions.
- Audit logging via Postgres triggers into an append-only audit_log table — never rely on
  application code to log access to health data.
- Start with Phase 0 (schema + compliance scaffolding) and Phase 1 (ops-console Next.js
  app + WhatsApp Cloud API integration) ONLY. Do not scaffold the field-app or
  family-portal until Phase 1 is explicitly marked complete — this is an intentional
  scope gate, not an oversight.
- Model credentials (Ghana Card, NMC PIN/AIN, police report, references, CPD/training) as
  one polymorphic credentialing subsystem driven by a credential_type reference table —
  do not create ad-hoc tables per document type.
- NMC PIN/AIN credentials expire every 12 months: build an Edge Function cron that flags
  providers within 30 days of expiry and auto-suspends scheduling eligibility on lapse.
- Caregiver ratings ARE shown to the assigned family as a real number ("4.9, 32 visits"),
  scoped only to that family — never a public cross-platform directory, never used to
  drive algorithmic reassignment/dispatch. Below 5 visits with a given client, show
  "New to this household" instead of a number. Safeguarding complaints are modeled as
  incident_report, routed to the clinical director, and are never averaged into a
  rating. Model both visit_rating (two-sided: family->caregiver and caregiver->household)
  and service_rating (periodic, CareBridge-level, separate from any single caregiver)
  as distinct entities — do not conflate them.
- Live visit tracking (live_visit_tracking) is foreground-only, scoped to the active
  scheduled visit window, and its raw location trail is purged once a visit is marked
  complete — retain only arrival/departure timestamps and zone. Never build continuous
  background staff tracking.
- Every non-trivial architectural decision gets a short ADR in docs/adr/.
- Use realistic-but-synthetic Ghanaian seed data for local development — never develop
  against real client PII.
- Follow the supervisor-worker operating model in docs/architecture (Part 7 of this
  brief): schema design, RLS policies, credential-expiry logic, financial calculations,
  audit-log triggers, and escalation/alert-routing logic are supervisor-tier work only,
  authored or fully reviewed by the highest-capability model available — never delegate
  these to a cheaper model even for a first draft. CRUD scaffolding, UI components
  against an established pattern, tests against a written spec, seed data, and docs are
  worker-tier — delegate these to save cost, but review any worker diff that touches a
  table schema or security boundary before merge, not just spot-check it.

At the start of every session: read docs/ROADMAP.md first (or carebridge-roadmap.md if
docs/ hasn't been created yet) to see current phase and status before doing anything
else. At the end of every session or completed story: update that file's checklist and
changelog — do not leave the next session to guess what's done. Do not unlock a phase's
checklist items until the current phase's exit criteria in the roadmap file are
explicitly checked off, even if it seems obviously fine to get a head start.

Build order for this session:
1. Scaffold the monorepo structure exactly as specified.
2. Write Supabase migrations for domains: Identity & Access, Client & Care Plan,
   Provider & Credentialing, Compliance & Audit — with RLS policies and a migration-time
   test asserting no table lacks a policy.
3. Build the ops-console Next.js app: client onboarding form, provider/credential
   management screens, visit scheduling and logging, exception queue view.
4. Integrate WhatsApp Cloud API for visit-summary and escalation message sending
   (templates to be approved out-of-band with Meta — stub the send call behind a
   feature flag if approval isn't complete yet).
5. Wire the credential-expiry cron Edge Function.
6. Write CI: lint, typecheck, migration dry-run, RLS policy coverage check.

Stop and ask before proceeding into Phase 2 scope (native field app, family portal,
PowerSync offline sync) — that phase starts only after Phase 1 pilot metrics are
reviewed.
```

---

## Part 9 — Keeping the Build on Track Across Sessions

Part 8's prompt is a one-time kickoff. It tells an agent what to do on day one; it says nothing about what's already been built by the time you start session forty. Coding agent sessions don't share memory with each other — a fresh session either re-reads this entire brief to reconstruct state (expensive, and it still can't tell you what's actually in the repo versus what was only planned) or loses track of progress entirely and starts guessing.

The fix is a second file, deliberately kept separate from this one: **`docs/ROADMAP.md`** (seeded as `carebridge-roadmap.md` in this folder for now — move it into `docs/` when the repo is scaffolded in Phase 0). Two different documents, two different lifecycles:

| | This brief | The roadmap file |
|---|---|---|
| Answers | Why, and what's the target design | Where are we right now, what's next |
| Changes | Only when a real architecture decision changes | Every session, every completed story |
| Read by agent | Once, at kickoff, and again only when a design question comes up | First thing, every single session |

**Rules that make this actually work, not just exist:**

1. **Read `docs/ROADMAP.md` first, every session, before touching code or this brief.** It tells the agent the current phase, what's checked off, and what's next in scope.
2. **Update it at the end of every session or completed story** — check off items, add anything newly discovered (edge cases, stories that turned out to be two stories), one-line changelog entry. An agent that finishes work without updating this file has left the next session blind.
3. **Phase gates are enforced here, not just stated in Part 0.** The next phase's checklist stays visually locked/collapsed until the current phase's exit criteria (defined per-phase in Part 5) are explicitly checked off. This is what actually stops a long, enthusiastic session from wandering into Phase 2 native-app work while Phase 1 is still unproven — a rule stated once in a brief gets forgotten three hundred tool calls into a session; a locked checklist section doesn't.
4. **Git history is the secondary source of truth.** Every completed story should land as a commit or PR that references the roadmap checklist item it closes — the two stay in sync, and you get the same audit trail discipline the domain model already requires of the product itself (Part 3, Part 6) applied to the build process.

Reserve full re-reads of this architecture brief for genuine design questions ("should this table have RLS," "what's the credentialing expiry rule") — day-to-day "what do I build next" should resolve from the roadmap file alone. That's also where the supervisor-worker economics from Part 7 compound: a worker agent picking up the next roadmap item needs a five-line status file, not a 40-page brief, to know its scope.

## Next steps

1. Confirm or challenge the three calls in Part 0 — especially the clinical-boundary decision, since it drives licensing timeline.
2. Get the HeFRA domiciliary-nursing category and the DPC controller registration moving in parallel with Phase 0 engineering — neither blocks the other.
3. Validate the KYC vendor (Smile ID vs. Youverify) and confirm whether a DataFlow Group PSV engagement for NMC verification is commercially viable at your pilot scale, or whether manual portal checks are sufficient for 10-20 families.
4. When ready, hand Part 8 to your coding agent and hold the Phase 1 scope line — and set up the supervisor/worker agent split from Part 7 before the first line of code, not after cost overruns force the conversation.

---

*Sources consulted for the Ghana regulatory and vendor claims in this document: HeFRA (hefra.gov.gh), Nursing and Midwifery Council of Ghana (nmc.gov.gh), Ghana's Data Protection Act 2012 (Act 843) and Data Protection Bill 2025 coverage (Business & Financial Times, Sustineri Attorneys, Digital Policy Alert), Supabase regions documentation, PowerSync/Supabase integration documentation, DataFlow Group's published NMC Ghana partnership. Verify current licensing categories, vendor coverage, and bill status directly before committing engineering or legal budget — the 2025 Bill in particular is still moving through the legislative process as of this writing.*
