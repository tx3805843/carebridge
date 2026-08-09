# ADR-0004: Supabase-managed Postgres over self-hosted at launch

**Status:** Proposed
**Date:** 2026-08-09

## Context

CareBridge's system of record must support fine-grained row-level access control (family
sponsors see only their client's data, gated by consent — see `packages/db/README.md`), an
append-only audit trail for health-data access, and file storage for credential documents,
all inside a small Phase 0-1 engineering budget. The realistic options are Supabase-managed
Postgres, a self-hosted Postgres instance (own or AWS RDS), or a NoSQL document store
(Firebase/Firestore).

## Decision

Use **Supabase-managed Postgres** at launch: native Row-Level Security, Auth, Storage,
Realtime, and Edge Functions in one managed surface, avoiding a bespoke services layer for
most of Phase 1-2. Supabase is open-source at its core (plain Postgres underneath), so a
later migration to self-hosted Postgres is a data/infra move, not a data-model rewrite.

Firestore is rejected: weak relational integrity and bolted-on-style security rules are a
poor fit for a clinical audit-trail domain model that leans on RLS as the primary access
control mechanism (see `packages/db/README.md`, ADR-0003).

## Consequences

- Phase 0-1 backend work is mostly schema + RLS policy + Edge Functions, not custom auth or
  file-storage services — matches the supervisor/worker split in the brief Part 7 (schema
  and RLS stay supervisor-tier; CRUD scaffolding against that schema is worker-tier).
- Because the core is open-source Postgres, the af-south-1 self-hosted migration path in
  ADR-0003 stays available if the Data Protection Bill mandates localization — this decision
  and ADR-0003 are coupled, not independent.
- Rejected: self-hosting from day one — would front-load infra/ops work (backups, Auth,
  Realtime, Storage) that Supabase gives for free at Phase 0-1 scale, for a compliance
  requirement (localization) that is not yet law.
- Rejected: Firestore — would require rebuilding RLS-equivalent access control and
  relational integrity by hand, higher risk for a health-data domain.
