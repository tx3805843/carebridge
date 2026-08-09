# CareBridge

Diaspora-serving home care coordination platform for Ghana — nurse-led, WhatsApp-first
Phase 1, offline-first field app and family portal in Phase 2. Full rationale in
`carebridge-architecture-and-build-prompt.md` and `docs/adr/`.

## Stack

- **DB / Auth / Storage / Realtime / Edge Functions:** Supabase (Postgres + RLS)
- **ops-console, family-portal:** Next.js (App Router, TypeScript) on Vercel
- **field-app:** Expo/React Native, offline-first sync via PowerSync
- **Family comms:** WhatsApp Business Cloud API
- **Payments:** Paystack (GHS) + Stripe (diaspora currencies)
- **Monorepo:** pnpm workspaces + Turborepo

See the stack decision table in `carebridge-architecture-and-build-prompt.md` (Part 1)
for the "why" behind each choice.

## Structure

```
apps/
  ops-console/    Next.js — internal coordinator/clinical-director console (Phase 1)
  family-portal/  Next.js — family-facing dashboard (Phase 2)
  field-app/      Expo/React Native — caregiver/nurse offline-first app (Phase 2)
packages/
  db/             Supabase migration scripts, RLS policy docs, seed data
  domain/         Shared TypeScript domain types (hand-written now, generated later)
  ui/             Shared shadcn/ui-based component library
  whatsapp/       WhatsApp Cloud API client + message templates
  config/         Shared eslint/tsconfig/tailwind config
supabase/
  functions/      Edge Functions: escalation-engine, credential-expiry-cron,
                  whatsapp-webhook, invoice-generator
  migrations/     SQL migrations (supabase CLI managed)
docs/
  adr/            Architecture Decision Records — one per material decision
  domain-model.md Ten bounded domains, mapped to packages/domain/src/
  compliance/     DPC registration record, HeFRA licensing evidence index
```

## Getting started

```bash
pnpm install
cp apps/ops-console/.env.example apps/ops-console/.env.local
cp apps/family-portal/.env.example apps/family-portal/.env.local
pnpm dev        # runs all apps via turbo
```

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) for local DB/Edge
Function development (`supabase start`).

## Status

Scaffold stage — no schema, no live integrations yet. See `docs/adr/` for the three
locked-in architectural calls before writing product code against this repo.
