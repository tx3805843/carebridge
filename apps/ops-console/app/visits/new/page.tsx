import { PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { getBlockedReasons, getCurrentZoneId, type ProviderEligibilityProfile } from "@/lib/provider-eligibility";
import { VisitForm } from "./visit-form";

export default async function NewVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; visitScheduled?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { error, visitScheduled } = await searchParams;

  const supabase = await createClient();

  const [
    { data: clients },
    { data: providers },
    { data: roles },
    { data: verifiedProfiles },
    { data: rosterRows },
    { data: zones },
    { data: carePlans },
    { data: existingVisits },
  ] = await Promise.all([
    supabase.from("client").select("id, full_name, zone_id").order("full_name"),
    supabase.from("provider").select("id, user_id, employment_status"),
    supabase.from("role").select("id, slug"),
    supabase.from("verified_profile").select("provider_id, nmc_licensed"),
    supabase.from("roster").select("provider_id, zone_id, week_starting"),
    supabase.from("zone").select("id, name"),
    supabase.from("care_plan").select("client_id, summary, effective_from"),
    supabase
      .from("visit")
      .select("provider_id, client_id, scheduled_start, scheduled_end")
      .in("status", ["scheduled", "en_route", "in_progress"]),
  ]);

  const providerUserIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: providerUsers } =
    providerUserIds.length > 0
      ? await supabase.from("user").select("id, full_name, role_id").in("id", providerUserIds)
      : { data: [] };

  const providerUserById = new Map((providerUsers ?? []).map((user) => [user.id, user]));
  const roleSlugById = new Map((roles ?? []).map((role) => [role.id, role.slug]));
  const nmcLicensedByProviderId = new Map((verifiedProfiles ?? []).map((vp) => [vp.provider_id, vp.nmc_licensed]));
  const zoneNameById = new Map((zones ?? []).map((zone) => [zone.id, zone.name]));
  const clientLabelById = new Map((clients ?? []).map((client) => [client.id, client.full_name]));

  const rosterAssignments = (rosterRows ?? []).map((row) => ({
    providerId: row.provider_id,
    zoneId: row.zone_id,
    weekStarting: row.week_starting,
  }));

  const providerProfiles = (providers ?? []).map((provider) => {
    const user = providerUserById.get(provider.user_id);
    const roleSlug = user ? roleSlugById.get(user.role_id) : undefined;
    const currentZoneId = getCurrentZoneId(provider.id, rosterAssignments);
    const currentZoneName = currentZoneId ? zoneNameById.get(currentZoneId) : undefined;

    const profile: ProviderEligibilityProfile = {
      providerId: provider.id,
      isNurse: roleSlug === "nurse",
      employmentStatus: provider.employment_status,
      nmcLicensed: nmcLicensedByProviderId.get(provider.id) ?? false,
      currentZone: currentZoneId && currentZoneName ? { id: currentZoneId, name: currentZoneName } : null,
    };

    return { profile, label: user?.full_name ?? "Unnamed provider" };
  });

  const clientOptions = (clients ?? []).map((client) => ({ id: client.id, label: client.full_name }));

  const matrix: Record<
    string,
    { eligible: { id: string; label: string }[]; blocked: { id: string; label: string; reasons: string[] }[] }
  > = {};

  for (const client of clients ?? []) {
    const eligible: { id: string; label: string }[] = [];
    const blocked: { id: string; label: string; reasons: string[] }[] = [];

    for (const { profile, label } of providerProfiles) {
      const reasons = getBlockedReasons(profile, client.zone_id);

      if (reasons.length === 0) {
        eligible.push({ id: profile.providerId, label });
      } else {
        blocked.push({ id: profile.providerId, label, reasons });
      }
    }

    matrix[client.id] = { eligible, blocked };
  }

  const zoneNameByClientId: Record<string, string> = {};
  for (const client of clients ?? []) {
    zoneNameByClientId[client.id] = zoneNameById.get(client.zone_id) ?? "No zone";
  }

  const careplanByClientId: Record<string, { effectiveFrom: string; summary: string } | null> = {};
  for (const client of clients ?? []) {
    careplanByClientId[client.id] = null;
  }
  for (const carePlan of carePlans ?? []) {
    const current = careplanByClientId[carePlan.client_id];
    if (!current || carePlan.effective_from > current.effectiveFrom) {
      careplanByClientId[carePlan.client_id] = { effectiveFrom: carePlan.effective_from, summary: carePlan.summary };
    }
  }

  const visitsByProviderId: Record<string, { clientLabel: string; scheduledStart: string; scheduledEnd: string }[]> =
    {};
  for (const visit of existingVisits ?? []) {
    const entry = {
      clientLabel: clientLabelById.get(visit.client_id) ?? "Unknown client",
      scheduledStart: visit.scheduled_start,
      scheduledEnd: visit.scheduled_end,
    };
    (visitsByProviderId[visit.provider_id] ??= []).push(entry);
  }

  return (
    <AppShell user={staffUser}>
      <PageHeader title="Schedule a visit" />
      {visitScheduled ? <p className="mb-4 text-sm text-success">Visit scheduled.</p> : null}
      <VisitForm
        clients={clientOptions}
        matrix={matrix}
        zoneNameByClientId={zoneNameByClientId}
        careplanByClientId={careplanByClientId}
        visitsByProviderId={visitsByProviderId}
        error={error}
      />
    </AppShell>
  );
}
