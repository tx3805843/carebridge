# @carebridge/db

Scripts and docs around the Supabase-managed Postgres instance. Actual SQL migration files
live at `supabase/migrations/` (Supabase CLI's expected location) — this package wraps them
with pnpm scripts and holds RLS policy documentation and seed data.

- `migrate:new` — scaffold a new timestamped migration under `supabase/migrations/`
- `migrate:dry-run` — required CI check before any migration merges (see `.github/workflows/migration-dry-run.yml`)
- `types:generate` — regenerate `packages/domain/src/generated.ts` from the live schema

## RLS model

Every table's row-level security policy resolves access through `consent_grant`
(see `packages/domain/src/identity.ts`), not role alone — a family sponsor with a role
still needs an explicit consent grant to read clinical detail. Document each table's
policy rationale in `rls/<table>.md` as migrations land.

## Seed data

The actual seed fixtures live at `supabase/seed.sql` (fixed name/location — a Supabase CLI
convention), not under `seed/`: `supabase db reset` auto-applies migrations then that file.
Every row uses a fixed UUID with `on conflict ... do nothing`, so it's safe to re-run against
an already-seeded database. `seed/run.mjs` (`pnpm seed`) just shells out to `supabase db
reset`. Currently 5 client-families, 6 sponsors (one client has two, to exercise
`decision_maker_hierarchy` ordering), 6 providers across a deliberate mix of credential
states (verified, pending, and one expired NMC PIN/AIN), and one sponsor with a family link
but no `consent_grant` — so the "linked but not consented" guardrail case ships as seed data,
not just an ad hoc test. All realistic-but-synthetic Ghanaian data (CLAUDE.md: never real
client PII).
