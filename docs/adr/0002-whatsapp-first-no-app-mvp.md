# ADR-0002: WhatsApp + coordinator console for Phase 1, no consumer app

**Status:** Proposed
**Date:** 2026-08-09

## Context

Native apps are tempting to build early, but Phase 1's job is to validate visit-completion
rates and staff reliability with 10-20 pilot families before committing to a polished
consumer surface.

## Decision

Phase 1 ships as WhatsApp (family communication + trust cards + live-visit status) + the
`ops-console` coordinator/clinical-director web console + digital forms + payment links.
`family-portal` and `field-app` are explicitly Phase 2, scoped and funded by what Phase 1
teaches about which alerts and workflows families actually use.

## Consequences

- `packages/whatsapp` and the `whatsapp-webhook` / `escalation-engine` Edge Functions are
  the Phase 1 critical path, not `family-portal`.
- `apps/family-portal` and `apps/field-app` exist as scaffolds now so the domain layer
  (`packages/domain`) is shared from day one, but should not receive product investment
  until Phase 1 pilot data justifies it.
- Rejected: building a polished family-facing app before validating operational
  reliability — high risk of over-investing in UI before the trust workflow is proven.
