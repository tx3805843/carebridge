# CareBridge Domain Model

Canonical source: `carebridge-architecture-and-build-prompt.md` (Part 2-3) at repo root.
This file tracks the bounded-domain summary and its mapping to `packages/domain/src/`;
keep both in sync as migrations land.

## Ten bounded domains

| # | Domain | Core entities | Module |
|---|---|---|---|
| 1 | Identity & Access | `user`, `role`, `family_sponsor`, `authority_grant`, `consent_grant` | `identity.ts` |
| 2 | Client & Care Plan | `client`, `care_plan`, `emergency_contact`, `decision_maker_hierarchy` | `care-plan.ts` |
| 3 | Provider & Credentialing | `provider`, `credential`, `credential_verification_event`, `identity_verification`, `background_check`, `training_record`, `verified_profile` | `credentialing.ts` |
| 4 | Scheduling & Visit Ops | `roster`, `zone`, `visit`, `visit_checkin`, `observation`, `task` | `scheduling.ts` |
| 5 | Trust, Rating & Feedback | `visit_rating`, `service_rating`, `live_visit_tracking`, `provider_quality_score`, `complaint`, `safeguarding_case` | `trust.ts` |
| 6 | Care Coordination | `appointment`, `referral`, `transport_booking`, `pharmacy_order`, `provider_network_partner` | `coordination.ts` |
| 7 | Communications & Alerts | `notification`, `whatsapp_message_log`, `escalation`, `alert_rule` | `communications.ts` |
| 8 | Billing & Financial Controls | `subscription`, `invoice`, `prepaid_wallet`, `expense_approval`, `payment` | `billing.ts` |
| 9 | Compliance & Audit | `consent_record`, `dpc_registration`, `audit_log`, `incident_report`, `data_retention_policy` | `compliance.ts` |
| 10 | Analytics & Quality | `kpi_snapshot`, `zone_performance`, `retention_metric` | `analytics.ts` |

## Cross-cutting rules

- **Consent, not just role, gates access.** Every RLS policy resolves through
  `consent_grant` — see `packages/db/README.md`.
- **Credentials are polymorphic.** One `credential` table driven by `credential_type`,
  not a table per document type (NMC PIN, police report, training record, etc.) — see
  ADR-0001 and Part 3.1 of the architecture brief.
- **Location data is visit-scoped, not persistent.** `visit_checkin.geoZoneOnly` is
  purged of raw location trail once a visit closes — see Part 3.2 of the architecture
  brief and ADR-0003's data-residency framing.
- **Escalation is first-class**, not a `notification` subtype — it carries its own
  severity and status lifecycle independent of how it was delivered.

## Types

`packages/domain/src/` currently holds hand-written placeholder types matching this
table. Once `supabase/migrations/` has real DDL, regenerate with
`pnpm --filter @carebridge/db types:generate` and retire the hand-written versions
module by module.
