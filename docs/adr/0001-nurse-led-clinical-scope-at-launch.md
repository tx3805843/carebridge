# ADR-0001: Launch nurse-led, narrow clinical scope

**Status:** Proposed
**Date:** 2026-08-09

## Context

HeFRA's domiciliary nursing category requires only two registered nurses with 5+ years'
post-qualification experience in good standing with the NMC — achievable within a 90-day
launch window. The business doc left open whether to launch companion-care-first or
nurse-led.

## Decision

Launch nurse-led, not companion-only, with clinical scope narrowed to vitals, medication
reconciliation, chronic-disease monitoring, and basic wound/post-op care within protocol.
Full hospital-adjacent clinical services (invasive procedures, complex wound care) stay
out of scope until there is volume and a stronger clinical governance bench.

## Consequences

- `provider.role` and `credential` types must model NMC PIN/AIN as a first-class,
  expiring credential (see ADR-0002-adjacent note in `packages/domain/src/credentialing.ts`).
- Scope-of-practice attestation becomes a hard gate on visit scheduling (Part 3.1 of the
  architecture brief) — every visit type is checked against the provider's current
  attested scope before scheduling allows it.
- Rejected: companion-care-first — slower to differentiate, undersells the "nurse-led"
  trust positioning the business doc already commits to.
