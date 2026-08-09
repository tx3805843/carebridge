# ADR-0003: Architect for Ghana data localization now; host EU West at launch

**Status:** Proposed
**Date:** 2026-08-09

## Context

Ghana's Data Protection Act, 2012 (Act 843) requires DPC registration for controllers
processing personal data, with tighter obligations for "special personal data" (health
status is explicitly named). The Data Protection Bill, 2025 — moving through Parliament —
adds mandatory localization for health records and biometric data. CareBridge is a
diaspora-serving business built on cross-border data flow by design. Supabase does not
currently offer a managed African region.

## Decision

Host on Supabase-managed **EU West (London)** at launch. Design the schema so
health/biometric tables can be extracted to a self-hosted Postgres in **AWS af-south-1
(Cape Town)** or a Ghana-based provider without a full re-platform, should the Data
Protection Bill mandate localization.

## Consequences

- Schema isolation for health/biometric data is a Phase 0 decision, not deferred —
  `packages/db` migrations should keep clinical tables (observations, care plans,
  credentials) separable from operational tables from the first migration.
- `docs/compliance/` tracks DPC registration status and must be revisited if/when the
  Data Protection Bill, 2025 passes.
- Rejected: waiting to decide hosting/residency later — re-platforming under regulatory
  deadline pressure in 12-18 months is materially more expensive than designing for it now.
