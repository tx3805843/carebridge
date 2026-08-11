# Roster Weekly Coverage Board (Increment D3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New `/roster/coverage` page shows, for a selected week, a zone-grouped coverage
board (workload, leave, conflicts, credential-state per rostered provider, plus a coverage-gap
flag on empty zones and a trailing unrostered-providers list) with a `?view=table` accessible
alternative rendering the same computed data as a flat `DataTable`. `/roster` (the existing
assignment form + all-time list) is untouched except for a new link to the coverage page. No
schema change.

**Architecture:** New pure-logic module `apps/ops-console/lib/roster-coverage.ts`
(`computeZoneCoverage`, `countOverlappingPairs`, employment-status label/variant maps) —
same shape as C1's `provider-eligibility.ts` and D1's `provider-verification-status.ts`. New
route `apps/ops-console/app/roster/coverage/page.tsx` fetches zones, all providers, the
selected week's `roster` rows, and that week's non-cancelled `visit` rows for rostered
providers in one batch, builds one shared row array via the new module plus C1's existing
`getBlockedReasons` (unmodified, target zone = the zone the provider is rostered to *for the
selected week*, not C1's own "most recent regardless of week" concept), then renders either
the zone-card board or the flat table from that same array depending on `?view=`.

**Tech Stack:** Next.js App Router server component, Supabase JS client, plain TypeScript. No
test runner exists for `ops-console` — verification is `typecheck`/`lint` plus a real browser
walkthrough against local Postgres, matching every prior increment.

**Spec:** `docs/superpowers/specs/2026-08-11-roster-coverage-d3-design.md`

---

### Task 1: `roster-coverage.ts` — pure zone-coverage/conflict module

**Files:**
- Create: `apps/ops-console/lib/roster-coverage.ts`

- [ ] **Step 1: Write the module**

```ts
// Pure logic for the roster weekly coverage board (Increment D3): zone-grouped coverage gaps
// and per-provider visit-overlap detection. Reused by app/roster/coverage/page.tsx. No
// schema change — all inputs come from already-fetched roster/visit rows for one specific
// week.

export interface ZoneCoverageInput {
  zoneId: string;
  providerId: string;
}

export interface ZoneCoverage {
  zoneId: string;
  providerIds: string[];
  isGap: boolean;
}

// Groups a single week's roster rows by zone, returning every zone — including ones with
// zero rostered providers, which is the gap this board exists to surface — alongside the
// provider ids rostered there.
export function computeZoneCoverage(zones: { id: string }[], rosterRows: ZoneCoverageInput[]): ZoneCoverage[] {
  const providerIdsByZoneId = new Map<string, string[]>();
  for (const row of rosterRows) {
    const list = providerIdsByZoneId.get(row.zoneId) ?? [];
    list.push(row.providerId);
    providerIdsByZoneId.set(row.zoneId, list);
  }

  return zones.map((zone) => {
    const providerIds = providerIdsByZoneId.get(zone.id) ?? [];
    return { zoneId: zone.id, providerIds, isGap: providerIds.length === 0 };
  });
}

export interface VisitWindow {
  start: string; // ISO timestamptz
  end: string; // ISO timestamptz
}

// Counts pairs of visits whose time ranges overlap — same overlap definition
// app/visits/new/visit-form.tsx already uses for its advisory double-booking warning
// (`start < otherEnd && end > otherStart`), reimplemented here for an all-pairs-in-a-set
// check rather than that module's one-new-visit-vs-existing shape. 0 = no conflict. Callers
// are expected to pre-filter to non-terminal visits (scheduled/en_route/in_progress) — the
// same status filter app/visits/new/page.tsx already uses for the identical conflict
// concept — since a completed or cancelled visit's time slot can't meaningfully double-book
// anything.
export function countOverlappingPairs(visits: VisitWindow[]): number {
  let count = 0;
  for (let i = 0; i < visits.length; i++) {
    const a = visits[i];
    if (!a) continue;
    for (let j = i + 1; j < visits.length; j++) {
      const b = visits[j];
      if (!b) continue;
      if (a.start < b.end && a.end > b.start) {
        count++;
      }
    }
  }
  return count;
}

export const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  on_leave: "On leave",
  departed: "Departed",
};

export const EMPLOYMENT_STATUS_VARIANT: Record<string, "success" | "warning" | "neutral"> = {
  active: "success",
  on_leave: "warning",
  departed: "neutral",
};
```

- [ ] **Step 2: Typecheck (new file, no consumers yet — should pass standalone)**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ops-console/lib/roster-coverage.ts
git commit -m "D3: add roster-coverage module (zone-gap + overlap-count logic)"
```

---

### Task 2: `/roster/coverage` page — board + table views

**Files:**
- Create: `apps/ops-console/app/roster/coverage/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import Link from "next/link";
import { Button, buttonVariants, cn, DataTable, PageHeader, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { getBlockedReasons, type ProviderEligibilityProfile } from "@/lib/provider-eligibility";
import {
  computeZoneCoverage,
  countOverlappingPairs,
  EMPLOYMENT_STATUS_LABEL,
  EMPLOYMENT_STATUS_VARIANT,
} from "@/lib/roster-coverage";

// Visits in a non-terminal status are the only ones that can meaningfully double-book a
// provider — matches the exact status filter app/visits/new/page.tsx already uses for the
// identical conflict concept.
const NON_TERMINAL_VISIT_STATUSES = ["scheduled", "en_route", "in_progress"];

type ViewMode = "board" | "table";

const WEEK_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function buildHref(week: string, view: ViewMode): string {
  const params = new URLSearchParams({ week, view });
  return `/roster/coverage?${params.toString()}`;
}

function shiftWeek(weekIso: string, days: number): string {
  const date = new Date(`${weekIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface CoverageRow {
  providerId: string;
  providerName: string;
  employmentStatus: string;
  blockedReasons: string[];
  workload: number | null;
  conflictCount: number | null;
}

interface ZoneCard {
  zoneId: string;
  zoneName: string;
  isGap: boolean;
  rows: CoverageRow[];
}

interface TableRow extends CoverageRow {
  zoneName: string;
}

function employmentBadge(status: string) {
  return (
    <StatusBadge
      variant={EMPLOYMENT_STATUS_VARIANT[status] ?? "neutral"}
      label={EMPLOYMENT_STATUS_LABEL[status] ?? status}
    />
  );
}

function blockedBadge(reasons: string[]) {
  if (reasons.length === 0) return null;
  return <StatusBadge variant="critical" label="Blocked" title={reasons.join("; ")} />;
}

function conflictBadge(count: number | null) {
  if (!count) return null;
  return <StatusBadge variant="warning" label={`Double-booked (${count})`} />;
}

function workloadLabel(workload: number | null): string {
  if (workload === null) return "—";
  return `${workload} visit${workload === 1 ? "" : "s"}`;
}

function CoverageRowLine({ row }: { row: CoverageRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm first:border-t-0">
      <span className="font-medium">{row.providerName}</span>
      <span className="text-muted-foreground">{workloadLabel(row.workload)}</span>
      {employmentBadge(row.employmentStatus)}
      {blockedBadge(row.blockedReasons)}
      {conflictBadge(row.conflictCount)}
    </div>
  );
}

export default async function RosterCoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { week: weekParam, view: viewParam } = await searchParams;
  const view: ViewMode = viewParam === "table" ? "table" : "board";

  const supabase = await createClient();

  let selectedWeek = weekParam && WEEK_PATTERN.test(weekParam) ? weekParam : null;
  if (!selectedWeek) {
    const { data: latestRoster } = await supabase
      .from("roster")
      .select("week_starting")
      .order("week_starting", { ascending: false })
      .limit(1)
      .maybeSingle();
    selectedWeek = latestRoster?.week_starting ?? new Date().toISOString().slice(0, 10);
  }

  const [{ data: zones }, { data: providers }, { data: roles }, { data: rosterRows }] = await Promise.all([
    supabase.from("zone").select("id, name").order("name"),
    supabase.from("provider").select("id, user_id, employment_status"),
    supabase.from("role").select("id, slug"),
    supabase.from("roster").select("provider_id, zone_id").eq("week_starting", selectedWeek),
  ]);

  const roleSlugById = new Map((roles ?? []).map((role) => [role.id, role.slug]));

  const userIds = (providers ?? []).map((provider) => provider.user_id);
  const providerIds = (providers ?? []).map((provider) => provider.id);
  const rosteredProviderIds = (rosterRows ?? []).map((row) => row.provider_id);

  const weekStartIso = `${selectedWeek}T00:00:00.000Z`;
  const weekEndIso = `${shiftWeek(selectedWeek, 7)}T00:00:00.000Z`;

  const [{ data: users }, { data: verifiedProfiles }, { data: visits }] = await Promise.all([
    userIds.length > 0
      ? supabase.from("user").select("id, full_name, role_id").in("id", userIds)
      : Promise.resolve({ data: [] }),
    providerIds.length > 0
      ? supabase.from("verified_profile").select("provider_id, nmc_licensed").in("provider_id", providerIds)
      : Promise.resolve({ data: [] }),
    rosteredProviderIds.length > 0
      ? supabase
          .from("visit")
          .select("provider_id, scheduled_start, scheduled_end, status")
          .in("provider_id", rosteredProviderIds)
          .gte("scheduled_start", weekStartIso)
          .lt("scheduled_start", weekEndIso)
          .neq("status", "cancelled")
      : Promise.resolve({ data: [] }),
  ]);

  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const nmcLicensedByProviderId = new Map((verifiedProfiles ?? []).map((vp) => [vp.provider_id, vp.nmc_licensed]));
  const zoneIdByProviderId = new Map((rosterRows ?? []).map((row) => [row.provider_id, row.zone_id]));
  const zoneNameById = new Map((zones ?? []).map((zone) => [zone.id, zone.name]));

  const visitsByProviderId: Record<string, { scheduled_start: string; scheduled_end: string; status: string }[]> = {};
  for (const visit of visits ?? []) {
    (visitsByProviderId[visit.provider_id] ??= []).push(visit);
  }

  function buildRow(providerId: string, includeWorkload: boolean): CoverageRow | null {
    const provider = (providers ?? []).find((candidate) => candidate.id === providerId);
    if (!provider) return null;

    const user = userById.get(provider.user_id);
    const roleSlug = user ? roleSlugById.get(user.role_id) : undefined;
    const isNurse = roleSlug === "nurse";
    const targetZoneId = zoneIdByProviderId.get(providerId);
    const zoneName = targetZoneId ? zoneNameById.get(targetZoneId) : undefined;

    const profile: ProviderEligibilityProfile = {
      providerId,
      isNurse,
      employmentStatus: provider.employment_status,
      nmcLicensed: nmcLicensedByProviderId.get(providerId) ?? false,
      currentZone: targetZoneId && zoneName ? { id: targetZoneId, name: zoneName } : null,
    };
    const blockedReasons = getBlockedReasons(profile, profile.currentZone?.id ?? "");

    let workload: number | null = null;
    let conflictCount: number | null = null;
    if (includeWorkload) {
      const providerVisits = visitsByProviderId[providerId] ?? [];
      workload = providerVisits.length;
      const nonTerminal = providerVisits.filter((visit) => NON_TERMINAL_VISIT_STATUSES.includes(visit.status));
      conflictCount = countOverlappingPairs(
        nonTerminal.map((visit) => ({ start: visit.scheduled_start, end: visit.scheduled_end })),
      );
    }

    return {
      providerId,
      providerName: user?.full_name ?? "Unnamed provider",
      employmentStatus: provider.employment_status,
      blockedReasons,
      workload,
      conflictCount,
    };
  }

  const zoneCoverage = computeZoneCoverage(
    (zones ?? []).map((zone) => ({ id: zone.id })),
    (rosterRows ?? []).map((row) => ({ zoneId: row.zone_id, providerId: row.provider_id })),
  );

  const zoneCards: ZoneCard[] = zoneCoverage.map((coverage) => {
    const zone = (zones ?? []).find((candidate) => candidate.id === coverage.zoneId);
    return {
      zoneId: coverage.zoneId,
      zoneName: zone?.name ?? "Unknown zone",
      isGap: coverage.isGap,
      rows: coverage.providerIds
        .map((providerId) => buildRow(providerId, true))
        .filter((row): row is CoverageRow => row !== null),
    };
  });

  const unrostered = (providers ?? [])
    .filter((provider) => provider.employment_status !== "departed" && !rosteredProviderIds.includes(provider.id))
    .map((provider) => buildRow(provider.id, false))
    .filter((row): row is CoverageRow => row !== null);

  const prevWeek = shiftWeek(selectedWeek, -7);
  const nextWeek = shiftWeek(selectedWeek, 7);

  const tableRows: TableRow[] = [
    ...zoneCards.flatMap((card) => card.rows.map((row) => ({ ...row, zoneName: card.zoneName }))),
    ...unrostered.map((row) => ({ ...row, zoneName: "—" })),
  ];

  return (
    <AppShell user={staffUser}>
      <PageHeader
        title="Roster coverage"
        description={`Week of ${selectedWeek}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={buildHref(prevWeek, view)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              ← Previous week
            </Link>
            <Link href={buildHref(nextWeek, view)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Next week →
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form action="/roster/coverage" method="get" className="flex items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <input
            type="date"
            name="week"
            defaultValue={selectedWeek}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
          <Button type="submit" size="sm" variant="outline">
            Go to week
          </Button>
        </form>

        <div className="flex gap-2" role="tablist" aria-label="View">
          {(["board", "table"] as ViewMode[]).map((mode) => (
            <Link
              key={mode}
              href={buildHref(selectedWeek, mode)}
              role="tab"
              aria-selected={view === mode}
              className={cn(
                "rounded-md border border-border px-3 py-1.5 text-sm capitalize",
                view === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {mode}
            </Link>
          ))}
        </div>
      </div>

      {view === "board" ? (
        <div className="flex flex-col gap-4">
          {zoneCards.map((card) => (
            <div key={card.zoneId} className="rounded-md border border-border bg-surface p-4">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-base font-semibold">{card.zoneName}</h2>
                {card.isGap ? <StatusBadge variant="critical" label="Coverage gap" /> : null}
              </div>
              {card.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No providers rostered this week.</p>
              ) : (
                card.rows.map((row) => <CoverageRowLine key={row.providerId} row={row} />)
              )}
            </div>
          ))}

          <div className="rounded-md border border-border bg-surface p-4">
            <h2 className="mb-2 text-base font-semibold">Unrostered providers</h2>
            {unrostered.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every active provider is rostered this week.</p>
            ) : (
              unrostered.map((row) => <CoverageRowLine key={row.providerId} row={row} />)
            )}
          </div>
        </div>
      ) : (
        <DataTable<TableRow>
          rows={tableRows}
          rowKey={(row) => row.providerId}
          emptyMessage="No providers to show for this week."
          columns={[
            { key: "zone", header: "Zone", render: (row) => row.zoneName },
            { key: "provider", header: "Provider", render: (row) => row.providerName },
            { key: "workload", header: "Workload", render: (row) => workloadLabel(row.workload) },
            { key: "employment", header: "Employment", render: (row) => employmentBadge(row.employmentStatus) },
            {
              key: "credential",
              header: "Credential state",
              render: (row) => (
                <div className="flex flex-wrap gap-2">
                  {blockedBadge(row.blockedReasons) ?? <span className="text-muted-foreground">—</span>}
                  {conflictBadge(row.conflictCount)}
                </div>
              ),
            },
          ]}
        />
      )}
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
git add apps/ops-console/app/roster/coverage/page.tsx
git commit -m "D3: roster weekly coverage board (/roster/coverage), board + table views"
```

---

### Task 3: Link from `/roster` to the coverage board

**Files:**
- Modify: `apps/ops-console/app/roster/page.tsx:1-4,50-51`

- [ ] **Step 1: Add the import and the header link**

Current top of file:

```tsx
import { DataTable, PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { RosterForm } from "./roster-form";
```

Replace with:

```tsx
import Link from "next/link";
import { buttonVariants, DataTable, PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { RosterForm } from "./roster-form";
```

Current header line:

```tsx
      <PageHeader title="Roster" />
```

Replace with:

```tsx
      <PageHeader
        title="Roster"
        actions={
          <Link href="/roster/coverage" className={buttonVariants({ variant: "outline", size: "sm" })}>
            View coverage board
          </Link>
        }
      />
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/roster/page.tsx
git commit -m "D3: link /roster to the new coverage board"
```

---

### Task 4: Full typecheck/lint pass

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

### Task 5: Verify in the browser against real local Postgres

**Files:** none (verification only). Seed data has only one zone (`Accra Central`) and one
roster row ever created (Adjoa Asante, `c0000000-…-01`, week = `date_trunc('week',
current_date)`), and no `on_leave` provider — three states need a temporary SQL edit to
exercise, same pattern D1 used for its "Expiring" state. All edits are reverted via
`supabase db reset` in Step 8; none are committed.

- [ ] **Step 1: Start the stack**

`supabase status` (start with `supabase start` + `supabase db reset` if not running). Start
the dev server: `pnpm --filter ops-console dev` (background). Set a local dev password on
`coordinator1@carebridge.dev` if not already set this session:

```bash
curl -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/a0000000-0000-0000-0000-000000000001" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"password":"carebridge-dev-2026"}'
```

- [ ] **Step 2: Confirm baseline board with only seed data**

Log in as `coordinator1@carebridge.dev` / `carebridge-dev-2026`, go to `/roster`, click "View
coverage board". Confirm it lands on `/roster/coverage?week=<this week's Monday>&view=board`
(the default-week fallback picked up the one seeded roster row). Confirm exactly one zone
card, "Accra Central", with no Coverage-gap badge and one row: Adjoa Asante, Active, no
Blocked badge, no Double-booked badge. Confirm the Unrostered providers card lists exactly
Akosua Darko, Kwabena Appiah, Ama Boateng, and Yaa Asantewaa (all Active, `c0000000-…-02`
Kofi Owusu is `departed` and correctly excluded), each showing "—" for workload and a Blocked
badge only where `/providers` already shows one (Akosua Darko: "NMC PIN/AIN not licensed; not
yet rostered to any zone"; the two caregivers with no other blockers show no Blocked badge
beyond "not yet rostered to any zone" — confirm against `/providers`' own Blocked text for
each, same cross-check D1 already established).

- [ ] **Step 3: Confirm the accessible table view shows identical data**

Click "table". Confirm the `DataTable` has one row per provider seen in Step 2 (5 rows total:
1 zone-assigned + 4 unrostered), same Zone/Provider/Workload/Employment/Credential values,
Adjoa Asante's Zone cell reads "Accra Central" and every unrostered provider's Zone cell reads
"—". Click "board" to switch back.

- [ ] **Step 4: Exercise the Coverage-gap state (temporary data edit)**

```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c \
  "insert into zone (id, name, created_by) values ('d0000000-0000-0000-0000-000000000099', 'Tema', 'a0000000-0000-0000-0000-000000000001');"
```

Reload `/roster/coverage`. Confirm a second zone card, "Tema", now appears with a
"Coverage gap" badge and "No providers rostered this week."

- [ ] **Step 5: Exercise the "On leave" employment badge (temporary data edit)**

```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c \
  "update provider set employment_status = 'on_leave' where id = 'c0000000-0000-0000-0000-000000000003';"
```

Reload. Confirm Akosua Darko now shows an "On leave" badge (warning-colored, distinct from
her existing Blocked badge, which is unchanged) in the Unrostered providers card.

- [ ] **Step 6: Exercise the Double-booked conflict flag (temporary data edit)**

First, compute this week's Monday and Adjoa's actual visit count going in, so the expected
numbers below are grounded in what's really in the database rather than assumed (her two
seeded visits at `now() - 3 days` / `now() - 1 day` may or may not both fall in "this week"
depending on which day this is run):

```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c \
  "select date_trunc('week', current_date)::date as week_start, count(*) filter (
     where scheduled_start >= date_trunc('week', current_date)
       and scheduled_start < date_trunc('week', current_date) + interval '7 days'
       and status != 'cancelled'
   ) as workload_before
   from visit where provider_id = 'c0000000-0000-0000-0000-000000000001';"
```

Note `workload_before`. Then insert two overlapping visits for Adjoa within this week (day+2,
09:00-10:00 and 09:30-10:30 — a real 30-minute overlap):

```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c \
  "insert into visit (id, client_id, provider_id, care_plan_id, scheduled_start, scheduled_end, status, created_by) values
   ('f2000000-0000-0000-0000-000000000099', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', date_trunc('week', current_date) + interval '2 days 9 hours', date_trunc('week', current_date) + interval '2 days 10 hours', 'scheduled', 'a0000000-0000-0000-0000-000000000001'),
   ('f2000000-0000-0000-0000-00000000009a', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', date_trunc('week', current_date) + interval '2 days 9 hours 30 minutes', date_trunc('week', current_date) + interval '2 days 10 hours 30 minutes', 'scheduled', 'a0000000-0000-0000-0000-000000000001');"
```

Reload `/roster/coverage`. Confirm Adjoa Asante's row now shows "Double-booked (1)" and her
workload reads `workload_before + 2` visits (both new rows are non-cancelled and land inside
the week window by construction). Switch to table view, confirm the same two values appear in
her row there too.

- [ ] **Step 7: Confirm prev/next week navigation**

Click "Previous week". Confirm the URL's `week` param decreased by exactly 7 days and the
board now shows zero zones with any rostered provider (no roster rows exist for any week
other than the seeded current one) — every zone shows a Coverage-gap badge, including the
temporary Tema zone. Click "Next week" twice to return past the current week, confirm the
same empty-coverage result, then use the date-jump form to type the original week's date
directly and confirm the seeded/temporary data from Steps 2-6 reappears exactly as before.

- [ ] **Step 8: Clean up**

Revert every temporary edit from Steps 4-6:

```bash
supabase db reset
```

Stop the dev server. `supabase stop`.

No code changes in this task. If any step's actual result doesn't match what's described, do
not patch ad hoc — report exactly what happened so the relevant task above can be fixed.

---

### Task 6: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off Increment D3**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist):

```
  - [ ] Increment D3 (worker-tier, no schema): roster weekly coverage board by zone (workload, leave, conflicts, credential state), keeping an accessible table alternative
```

Replace with a checked line summarizing what was actually built and verified, in this file's
established style. Record at minimum: new `/roster/coverage` route, week selected via
`?week=` (defaulting to the latest `roster.week_starting` present, exact-match not
"most-recent-regardless-of-week" like C1/D1 use elsewhere); zone-grouped board with a
Coverage-gap badge on empty zones, per-provider workload (visit count)/employment badge/
Blocked badge (reusing `getBlockedReasons` unmodified)/Double-booked flag (new pairwise
overlap check, same overlap definition as C2's advisory warning); a trailing Unrostered
providers section excluding departed staff; a `?view=table` accessible alternative rendering
identical computed data through the existing `DataTable`; `/roster` itself untouched beside a
new link. Note that seed data has only one zone and no `on_leave` provider, so three states
(Coverage gap, On leave, Double-booked) were exercised via temporary SQL edits reverted
before finishing, same pattern D1 used for its Expiring state.

- [ ] **Step 2: Update the "Last updated" summary line**

Update the top summary line to reflect D3 is done and name Increment D4 as next, per the
epic's own ordering (confirm against the roadmap's own checklist rather than trusting this
plan's memory of it, in case the list has changed since this plan was written).

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment D3, next up Increment D4"
```

(Confirm the actual next-increment number against the roadmap's own checklist before writing
this commit message — the epic's ordering is the source of truth, not this plan's guess.)
