# Provider List Refresh (Increment D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/providers` shows explicit Verified/Missing/Not applicable/Expiring badges per
verification signal (ID, NMC, Background, Training), derived from the underlying evidence
tables rather than `verified_profile`'s flat booleans; a separate overall Blocked badge
reuses C1's scheduling-eligibility logic; search-by-name and three filter chips (Expiring
soon / Missing verification / Blocked) are added. No schema change. `/providers/[id]`
(detail page) is untouched — that's D2.

**Architecture:** New pure-logic module `apps/ops-console/lib/provider-verification-status.ts`
(same shape as C1's `provider-eligibility.ts`) computes each signal's state from
already-fetched evidence rows. `page.tsx` fetches `identity_verification`,
`credential` (NMC type only), `background_check`, `training_record`, and `roster` for all
listed providers (new — none of these are fetched today except indirectly), calls the new
module per provider, and reuses `getBlockedReasons` from `provider-eligibility.ts`
unmodified for the Blocked badge (target zone = the provider's own current zone, so the
zone-mismatch reason never fires spuriously with no client in view). Search/filter state
lives entirely in the URL (`?q=`, `?filter=`), matching `exceptions/page.tsx`'s existing
`view` param convention — no client component.

**Tech Stack:** Next.js App Router server component, Supabase JS client, plain TypeScript.
No test runner exists for `ops-console` — verification is `typecheck`/`lint` plus a real
browser walkthrough against local Postgres, matching every prior increment.

**Spec:** `docs/superpowers/specs/2026-08-11-provider-refresh-d1-design.md`

---

### Task 1: `provider-verification-status.ts` — pure badge-derivation module

**Files:**
- Create: `apps/ops-console/lib/provider-verification-status.ts`

- [ ] **Step 1: Write the module**

```ts
// Pure logic deriving each provider's per-signal verification badge state from the
// underlying evidence tables (identity_verification, credential, background_check,
// training_record) rather than trusting verified_profile's flat booleans — that summary is
// a separate cron/manually-maintained rollup (see D2, which governs making it trustworthy
// and read-only). Reused by app/providers/page.tsx.

export type VerificationState = "verified" | "missing" | "not_applicable" | "expiring";

// Matches credential-expiry-cron's own EXPIRY_WARNING_DAYS (supabase/functions/
// credential-expiry-cron/index.ts) — kept as a separate constant, not imported, since the
// cron runs in a separate Deno edge function, not this Next.js app.
export const EXPIRY_WARNING_DAYS = 30;

function isWithinWarningWindow(dateIso: string, todayIso: string, warningCutoffIso: string): boolean {
  return dateIso >= todayIso && dateIso <= warningCutoffIso;
}

function latestByCreatedAt<T extends { createdAt: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) => (row.createdAt > latest.createdAt ? row : latest));
}

export interface IdentityVerificationEvidence {
  status: string;
  createdAt: string;
}

// ID verification has no expiry concept anywhere in the schema — Verified or Missing only.
export function getIdStatus(rows: IdentityVerificationEvidence[]): VerificationState {
  const latest = latestByCreatedAt(rows);
  return latest?.status === "verified" ? "verified" : "missing";
}

export interface NmcCredentialEvidence {
  status: string;
  expiryDate: string | null;
  createdAt: string;
}

// NMC PIN/AIN only applies to nurses (CLAUDE.md — caregivers have no equivalent statutory
// credential). A credential past its expiry_date reads as Missing, not Expiring — matching
// credential-expiry-cron's own behavior (past-due credentials auto-flip to status='expired',
// at which point verified_profile.nmc_licensed goes false; this mirrors that end state even
// before the cron has run, since a lexical expiry_date < todayIso comparison doesn't need
// the cron to already have acted).
export function getNmcStatus(
  isNurse: boolean,
  rows: NmcCredentialEvidence[],
  todayIso: string,
  warningCutoffIso: string,
): VerificationState {
  if (!isNurse) return "not_applicable";

  const latest = latestByCreatedAt(rows);
  if (!latest || latest.status !== "verified") return "missing";
  if (!latest.expiryDate) return "verified";
  if (latest.expiryDate < todayIso) return "missing";
  return isWithinWarningWindow(latest.expiryDate, todayIso, warningCutoffIso) ? "expiring" : "verified";
}

export interface BackgroundCheckEvidence {
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

// Same expiry shape as NMC, but background_check isn't cron-recomputed today — reading
// straight from the evidence table here (rather than verified_profile.background_checked)
// surfaces staleness the manually-toggled flag could otherwise hide.
export function getBackgroundStatus(
  rows: BackgroundCheckEvidence[],
  todayIso: string,
  warningCutoffIso: string,
): VerificationState {
  const latest = latestByCreatedAt(rows);
  if (!latest || latest.status !== "verified") return "missing";
  if (!latest.expiresAt) return "verified";
  if (latest.expiresAt < todayIso) return "missing";
  return isWithinWarningWindow(latest.expiresAt, todayIso, warningCutoffIso) ? "expiring" : "verified";
}

export interface TrainingRecordEvidence {
  createdAt: string;
}

// training_record has no status or expiry field — any record at all counts as Verified.
export function getTrainingStatus(rows: TrainingRecordEvidence[]): VerificationState {
  return rows.length > 0 ? "verified" : "missing";
}

export interface ProviderVerificationBadges {
  id: VerificationState;
  nmc: VerificationState;
  background: VerificationState;
  training: VerificationState;
}

export function getProviderVerificationBadges(input: {
  isNurse: boolean;
  identityVerifications: IdentityVerificationEvidence[];
  nmcCredentials: NmcCredentialEvidence[];
  backgroundChecks: BackgroundCheckEvidence[];
  trainingRecords: TrainingRecordEvidence[];
  todayIso: string;
  warningCutoffIso: string;
}): ProviderVerificationBadges {
  return {
    id: getIdStatus(input.identityVerifications),
    nmc: getNmcStatus(input.isNurse, input.nmcCredentials, input.todayIso, input.warningCutoffIso),
    background: getBackgroundStatus(input.backgroundChecks, input.todayIso, input.warningCutoffIso),
    training: getTrainingStatus(input.trainingRecords),
  };
}
```

- [ ] **Step 2: Typecheck (new file, no consumers yet — should pass standalone)**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ops-console/lib/provider-verification-status.ts
git commit -m "D1: add provider-verification-status module (per-signal badge derivation)"
```

---

### Task 2: `page.tsx` — badges, Blocked column, search, filter chips

**Files:**
- Modify: `apps/ops-console/app/providers/page.tsx`

- [ ] **Step 1: Replace the whole file**

Current file (110 lines) fetches `provider`, `role`, `user`, and `verified_profile`, and
renders four flat boolean badges via a local `flagBadge` helper. Replace its full content
with:

```tsx
import Link from "next/link";
import { Button, buttonVariants, cn, DataTable, PageHeader, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { getBlockedReasons, getCurrentZoneId, type ProviderEligibilityProfile } from "@/lib/provider-eligibility";
import {
  getProviderVerificationBadges,
  type ProviderVerificationBadges,
  type VerificationState,
} from "@/lib/provider-verification-status";

const VERIFICATION_BADGE: Record<
  VerificationState,
  { variant: "success" | "warning" | "critical" | "neutral"; label: string }
> = {
  verified: { variant: "success", label: "Verified" },
  expiring: { variant: "warning", label: "Expiring" },
  missing: { variant: "critical", label: "Missing" },
  not_applicable: { variant: "neutral", label: "N/A" },
};

function verificationBadge(signalLabel: string, state: VerificationState) {
  const { variant, label } = VERIFICATION_BADGE[state];
  return <StatusBadge variant={variant} label={`${signalLabel} — ${label}`} />;
}

type FilterValue = "expiring" | "missing" | "blocked";

const FILTERS: { value?: FilterValue; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "expiring", label: "Expiring soon" },
  { value: "missing", label: "Missing verification" },
  { value: "blocked", label: "Blocked" },
];

function buildHref(q: string, filter?: FilterValue) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (filter) params.set("filter", filter);
  const qs = params.toString();
  return qs ? `/providers?${qs}` : "/providers";
}

interface ProviderRow {
  id: string;
  name: string;
  roleSlug: string | undefined;
  yearsExperience: number;
  employmentStatus: string;
  badges: ProviderVerificationBadges;
  blockedReasons: string[];
}

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { q = "", filter } = await searchParams;
  const activeFilter: FilterValue | undefined =
    filter === "expiring" || filter === "missing" || filter === "blocked" ? filter : undefined;

  const supabase = await createClient();

  const [{ data: providers }, { data: roles }, { data: zones }, { data: nmcCredentialType }] = await Promise.all([
    supabase
      .from("provider")
      .select("id, user_id, years_experience, employment_status")
      .order("created_at", { ascending: false }),
    supabase.from("role").select("id, slug"),
    supabase.from("zone").select("id, name"),
    supabase.from("credential_type").select("id").eq("slug", "nmc_pin_ain").maybeSingle(),
  ]);

  const roleSlugById = new Map((roles ?? []).map((role) => [role.id, role.slug]));
  const zoneNameById = new Map((zones ?? []).map((zone) => [zone.id, zone.name]));

  const userIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: users } =
    userIds.length > 0
      ? await supabase.from("user").select("id, full_name, role_id").in("id", userIds)
      : { data: [] };
  const userById = new Map((users ?? []).map((user) => [user.id, user]));

  const providerIds = (providers ?? []).map((provider) => provider.id);

  const [
    { data: identityVerifications },
    { data: nmcCredentials },
    { data: backgroundChecks },
    { data: trainingRecords },
    { data: rosterRows },
    { data: verifiedProfiles },
  ] = await Promise.all([
    providerIds.length > 0
      ? supabase.from("identity_verification").select("provider_id, status, created_at").in("provider_id", providerIds)
      : Promise.resolve({ data: [] }),
    providerIds.length > 0 && nmcCredentialType
      ? supabase
          .from("credential")
          .select("provider_id, status, expiry_date, created_at")
          .eq("credential_type_id", nmcCredentialType.id)
          .in("provider_id", providerIds)
      : Promise.resolve({ data: [] }),
    providerIds.length > 0
      ? supabase.from("background_check").select("provider_id, status, expires_at, created_at").in("provider_id", providerIds)
      : Promise.resolve({ data: [] }),
    providerIds.length > 0
      ? supabase.from("training_record").select("provider_id, created_at").in("provider_id", providerIds)
      : Promise.resolve({ data: [] }),
    providerIds.length > 0
      ? supabase.from("roster").select("provider_id, zone_id, week_starting").in("provider_id", providerIds)
      : Promise.resolve({ data: [] }),
    providerIds.length > 0
      ? supabase.from("verified_profile").select("provider_id, nmc_licensed").in("provider_id", providerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const identityByProviderId: Record<string, { status: string; created_at: string }[]> = {};
  for (const row of identityVerifications ?? []) {
    (identityByProviderId[row.provider_id] ??= []).push(row);
  }
  const nmcByProviderId: Record<string, { status: string; expiry_date: string | null; created_at: string }[]> = {};
  for (const row of nmcCredentials ?? []) {
    (nmcByProviderId[row.provider_id] ??= []).push(row);
  }
  const backgroundByProviderId: Record<string, { status: string; expires_at: string | null; created_at: string }[]> = {};
  for (const row of backgroundChecks ?? []) {
    (backgroundByProviderId[row.provider_id] ??= []).push(row);
  }
  const trainingByProviderId: Record<string, { created_at: string }[]> = {};
  for (const row of trainingRecords ?? []) {
    (trainingByProviderId[row.provider_id] ??= []).push(row);
  }

  // verified_profile.nmc_licensed — not the evidence-derived NMC badge above — feeds the
  // Blocked check below, so "Blocked" means exactly what /visits/new would enforce today
  // (getBlockedReasons re-derives this same flag server-side there). Deliberately two
  // separate NMC readings on this one page: the badge shows raw evidence state (can be
  // "Expiring" while still licensed), Blocked shows the live scheduling gate.
  const nmcLicensedByProviderId = new Map((verifiedProfiles ?? []).map((vp) => [vp.provider_id, vp.nmc_licensed]));

  const rosterAssignments = (rosterRows ?? []).map((row) => ({
    providerId: row.provider_id,
    zoneId: row.zone_id,
    weekStarting: row.week_starting,
  }));

  const todayIso = new Date().toISOString().slice(0, 10);
  const warningCutoffIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const providerRows: ProviderRow[] = (providers ?? []).map((provider) => {
    const user = userById.get(provider.user_id);
    const roleSlug = user ? roleSlugById.get(user.role_id) : undefined;
    const isNurse = roleSlug === "nurse";

    const badges = getProviderVerificationBadges({
      isNurse,
      identityVerifications: (identityByProviderId[provider.id] ?? []).map((row) => ({
        status: row.status,
        createdAt: row.created_at,
      })),
      nmcCredentials: (nmcByProviderId[provider.id] ?? []).map((row) => ({
        status: row.status,
        expiryDate: row.expiry_date,
        createdAt: row.created_at,
      })),
      backgroundChecks: (backgroundByProviderId[provider.id] ?? []).map((row) => ({
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      })),
      trainingRecords: (trainingByProviderId[provider.id] ?? []).map((row) => ({ createdAt: row.created_at })),
      todayIso,
      warningCutoffIso,
    });

    const currentZoneId = getCurrentZoneId(provider.id, rosterAssignments);
    const currentZoneName = currentZoneId ? zoneNameById.get(currentZoneId) : undefined;

    const profile: ProviderEligibilityProfile = {
      providerId: provider.id,
      isNurse,
      employmentStatus: provider.employment_status,
      nmcLicensed: nmcLicensedByProviderId.get(provider.id) ?? false,
      currentZone: currentZoneId && currentZoneName ? { id: currentZoneId, name: currentZoneName } : null,
    };

    const blockedReasons = getBlockedReasons(profile, profile.currentZone?.id ?? "");

    return {
      id: provider.id,
      name: user?.full_name ?? "Unnamed provider",
      roleSlug,
      yearsExperience: provider.years_experience,
      employmentStatus: provider.employment_status,
      badges,
      blockedReasons,
    };
  });

  const searchedRows = q ? providerRows.filter((row) => row.name.toLowerCase().includes(q.toLowerCase())) : providerRows;

  const filteredRows = !activeFilter
    ? searchedRows
    : searchedRows.filter((row) =>
        activeFilter === "blocked"
          ? row.blockedReasons.length > 0
          : [row.badges.id, row.badges.nmc, row.badges.background, row.badges.training].includes(activeFilter),
      );

  return (
    <AppShell user={staffUser}>
      <PageHeader
        title="Providers"
        actions={
          <Link href="/providers/new" className={buttonVariants()}>
            Onboard a provider
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <form action="/providers" method="get" className="flex flex-wrap items-center gap-2">
          {activeFilter ? <input type="hidden" name="filter" value={activeFilter} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name"
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
          {q ? (
            <Link href={buildHref("", activeFilter)} className="text-sm text-muted-foreground underline">
              Clear search
            </Link>
          ) : null}
        </form>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Provider filter">
          {FILTERS.map((option) => (
            <Link
              key={option.value ?? "all"}
              href={buildHref(q, option.value)}
              role="tab"
              aria-selected={activeFilter === option.value}
              className={cn(
                "rounded-md border border-border px-3 py-1.5 text-sm",
                activeFilter === option.value ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      <DataTable<ProviderRow>
        rows={filteredRows}
        rowKey={(row) => row.id}
        emptyMessage={(providers ?? []).length === 0 ? "No providers yet." : "No providers match this search or filter."}
        columns={[
          {
            key: "name",
            header: "Name",
            render: (row) => (
              <Link href={`/providers/${row.id}`} className="underline">
                {row.name}
              </Link>
            ),
          },
          {
            key: "role",
            header: "Role",
            render: (row) => <span className="capitalize">{row.roleSlug ?? "—"}</span>,
          },
          { key: "experience", header: "Experience", render: (row) => `${row.yearsExperience} yrs` },
          {
            key: "status",
            header: "Status",
            render: (row) => <span className="capitalize">{row.employmentStatus.replace("_", " ")}</span>,
          },
          {
            key: "verification",
            header: "Verification",
            render: (row) => (
              <div className="flex flex-wrap gap-2">
                {verificationBadge("ID", row.badges.id)}
                {verificationBadge("NMC", row.badges.nmc)}
                {verificationBadge("Background", row.badges.background)}
                {verificationBadge("Training", row.badges.training)}
              </div>
            ),
          },
          {
            key: "scheduling",
            header: "Scheduling",
            render: (row) =>
              row.blockedReasons.length > 0 ? (
                <StatusBadge variant="critical" label="Blocked" title={row.blockedReasons.join("; ")} />
              ) : null,
          },
        ]}
      />
    </AppShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/providers/page.tsx
git commit -m "D1: provider list badges (evidence-derived), Blocked column, search, filters"
```

---

### Task 3: Full typecheck/lint pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 3: Fix and re-run if either fails**

Fix any reported issue in the file it names, re-run both until clean.

---

### Task 4: Verify in the browser against real local Postgres

**Files:** none (verification only)

Ground truth from `supabase/seed.sql`'s six providers, worked out against the derivation
rules in Task 1 (do not re-derive from scratch during verification — confirm the UI matches
these expected values):

| Provider | Role | ID | NMC | Background | Training | Blocked reasons |
|---|---|---|---|---|---|---|
| Adjoa Asante (`c0000000-…-01`) | nurse | Verified | Verified | Verified | Verified | none |
| Kofi Owusu (`c0000000-…-02`) | nurse | Missing | Missing | Verified | Verified | NMC PIN/AIN not licensed; no longer active (departed); not yet rostered to any zone |
| Akosua Darko (`c0000000-…-03`) | nurse | Verified | Missing | Verified | Verified | NMC PIN/AIN not licensed; not yet rostered to any zone |
| Kwabena Appiah (`c0000000-…-04`) | caregiver | Verified | N/A | Verified | Verified | not yet rostered to any zone |
| Ama Boateng (`c0000000-…-05`) | caregiver | Verified | N/A | Missing | Missing | not yet rostered to any zone |
| Yaa Asantewaa (`c0000000-…-06`) | caregiver | Verified | N/A | Verified | Verified | not yet rostered to any zone |

Only Adjoa Asante has a roster row in seed data (from Increment C1's own verification) — the
other five are all "not yet rostered," hence 5 of 6 show Blocked. No seeded row currently
sits inside the 30-day "Expiring" window (all future expiry/expires_at dates are 7+ months
out), so Expiring is exercised via a temporary SQL edit in Step 4 below, reverted in Step 6.

- [ ] **Step 1: Start the stack**

`supabase status` (start with `supabase start` + `supabase db reset` if not running). Start
the dev server: `pnpm --filter ops-console dev` (background). Set a local dev password on
`coordinator1@carebridge.dev` if not already set this session (auth rows in `seed.sql` are
inserted directly, with no password — this must be set after every `supabase db reset`):

```bash
curl -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/a0000000-0000-0000-0000-000000000001" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"password":"carebridge-dev-2026"}'
```

- [ ] **Step 2: Confirm the table against the ground-truth grid**

Log in as `coordinator1@carebridge.dev` / `carebridge-dev-2026`, go to `/providers`. For each
of the six providers, read the rendered Verification and Scheduling columns and confirm they
match the grid above exactly — badge label text (e.g. "NMC — Missing", not just a color),
and the Blocked badge's `title` attribute (hover, or inspect the DOM attribute) matches the
listed reasons joined with `; `.

- [ ] **Step 3: Confirm search**

Enter `Owusu` in the search box, submit. Confirm only Kofi Owusu's row shows. Clear the
search (click "Clear search"), confirm all six rows return. Enter `asante` (lowercase, partial)
and submit. Confirm exactly two rows show — Adjoa Asante and Yaa Asantewaa (whose name
contains "Asante" as a substring within "Asantewaa") — proving the match is substring and
case-insensitive, not exact/prefix-only.

- [ ] **Step 4: Exercise the "Expiring" state (temporary data edit)**

Not present in seed data as-is — temporarily pull two credentials into the 30-day window:

```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c \
  "update credential set expiry_date = current_date + 15 where id = 'e3000000-0000-0000-0000-000000000001';"
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c \
  "update background_check set expires_at = current_date + 15 where id = 'e6000000-0000-0000-0000-000000000001';"
```

Reload `/providers`. Confirm Adjoa Asante's row now shows "NMC — Expiring" and
"Background — Expiring" (both warning-colored), and that her Blocked column is still empty —
`verified_profile.nmc_licensed` for her is untouched by this edit, so the live scheduling
gate (Blocked) correctly doesn't move just because the underlying evidence is approaching
expiry; only the evidence-derived badge does. This is the concrete case the spec's
verification plan calls for (confirms the two NMC readings on this page are genuinely
independent, not two labels for the same computation).

- [ ] **Step 5: Confirm the "Expiring soon" filter**

Click the "Expiring soon" chip. Confirm exactly one row shows (Adjoa Asante). Click "All" to
return to the full list.

- [ ] **Step 6: Confirm the "Missing verification" and "Blocked" filters**

Click "Missing verification". Confirm exactly Kofi Owusu, Akosua Darko, and Ama Boateng show
(the three rows with at least one Missing badge in the ground-truth grid; Adjoa Asante does
not appear here even though her NMC/Background are now "Expiring" from Step 4 — Expiring is
a distinct state from Missing). Click "Blocked". Confirm exactly the five rows other than
Adjoa Asante show.

- [ ] **Step 7: Confirm the Blocked badge matches `/visits/new`'s own eligibility check**

Go to `/visits/new`, select any active client, open the provider dropdown. Confirm the
"Blocked" optgroup's reason text for Kofi Owusu and Akosua Darko matches what `/providers`
showed in Step 2 (same wording, same reasons) — proving the reused `getBlockedReasons` call
produces identical output on both pages, not a subtly different derivation.

- [ ] **Step 8: Clean up**

Revert the two temporary edits from Step 4 and wipe any incidental test state:

```bash
supabase db reset
```

Stop the dev server. `supabase stop`.

No code changes in this task. If any step's actual result doesn't match the expected grid,
do not patch ad hoc — report exactly what happened so the relevant task above can be fixed.

---

### Task 5: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off Increment D1**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist):

```
  - [ ] Increment D1 (worker-tier, no schema): provider list/detail refresh — explicit Verified/Missing/Not applicable/Expiring/Blocked badges, search and saved filters
```

Replace with a checked line summarizing what was actually built and verified, in this file's
established style. Record at minimum: badges are derived from evidence tables
(`identity_verification`/`credential`/`background_check`/`training_record`), not
`verified_profile`'s flags, so they can surface staleness the manual flags hide; detail page
was deliberately left untouched (D2's scope); the overall Blocked badge reuses C1's
`getBlockedReasons` via the provider's-own-zone-as-target trick and was confirmed to match
`/visits/new`'s own eligibility output; search/filters are URL-param-driven with no
persistence; and the real verification performed (ground-truth grid against seed data,
temporary edit to exercise the Expiring state since no seeded row sits in that window,
cross-check against `/visits/new`).

- [ ] **Step 2: Update the "Last updated" summary line**

Update the top summary line to reflect D1 is done and name Increment D2 as next, per the
epic's own ordering (confirm against the roadmap's own checklist rather than trusting this
plan's memory of it, in case the list has changed since this plan was written).

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment D1, next up Increment D2"
```

(Confirm the actual next-increment number against the roadmap's own checklist before writing
this commit message — the epic's ordering is the source of truth, not this plan's guess.)
