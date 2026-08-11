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
