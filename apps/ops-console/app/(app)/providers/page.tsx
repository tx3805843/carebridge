import Link from "next/link";
import { Button, buttonVariants, cn, DataTable, PageHeader, StatusBadge } from "@carebridge/ui";
import { createClient } from "@/lib/supabase/server";
import { getBlockedReasons, getCurrentZoneId, type ProviderEligibilityProfile } from "@/lib/provider-eligibility";
import {
  EXPIRY_WARNING_DAYS,
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
  const warningCutoffIso = new Date(Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

    // Pass the provider's own current zone as the target: this trivially satisfies the
    // zone-match check (a provider is always in its own zone), so only the "not yet
    // rostered to any zone" reason can still fire here — there's no specific client on
    // this page to compare a real zone mismatch against.
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
    <>
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
            aria-label="Search providers by name"
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
                <span title={row.blockedReasons.join("; ")}>
                  <StatusBadge variant="critical" label="Blocked" />
                  <span className="sr-only">: {row.blockedReasons.join("; ")}</span>
                </span>
              ) : null,
          },
        ]}
      />
    </>
  );
}
