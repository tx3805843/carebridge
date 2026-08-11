"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBlockedReasons, getCurrentZoneId, type ProviderEligibilityProfile } from "@/lib/provider-eligibility";

export async function scheduleVisit(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const scheduledStart = String(formData.get("scheduledStart") ?? "");
  const scheduledEnd = String(formData.get("scheduledEnd") ?? "");

  if (!clientId || !providerId || !scheduledStart || !scheduledEnd) {
    redirect(`/visits/new?error=${encodeURIComponent("Client, provider, and start/end times are all required.")}`);
  }

  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("client")
    .select("status, zone_id")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError || !client) {
    redirect(`/visits/new?error=${encodeURIComponent("Client not found.")}`);
  }

  if (client.status !== "active") {
    redirect(
      `/visits/new?error=${encodeURIComponent("This client is not active — reactivate them before scheduling a visit.")}`,
    );
  }

  const { data: provider, error: providerError } = await supabase
    .from("provider")
    .select("id, user_id, employment_status")
    .eq("id", providerId)
    .maybeSingle();

  if (providerError || !provider) {
    redirect(`/visits/new?error=${encodeURIComponent("Provider not found.")}`);
  }

  const [{ data: providerUser }, { data: nurseRole }, { data: verifiedProfile }, { data: rosterRows }, { data: zones }] =
    await Promise.all([
      supabase.from("user").select("role_id").eq("id", provider.user_id).maybeSingle(),
      supabase.from("role").select("id").eq("slug", "nurse").single(),
      supabase.from("verified_profile").select("nmc_licensed").eq("provider_id", providerId).maybeSingle(),
      supabase.from("roster").select("zone_id, week_starting").eq("provider_id", providerId),
      supabase.from("zone").select("id, name"),
    ]);

  const zoneNameById = new Map((zones ?? []).map((zone) => [zone.id, zone.name]));
  const currentZoneId = getCurrentZoneId(
    providerId,
    (rosterRows ?? []).map((row) => ({ providerId, zoneId: row.zone_id, weekStarting: row.week_starting })),
  );
  const currentZoneName = currentZoneId ? zoneNameById.get(currentZoneId) : undefined;

  const profile: ProviderEligibilityProfile = {
    providerId,
    isNurse: providerUser?.role_id === nurseRole?.id,
    employmentStatus: provider.employment_status,
    nmcLicensed: verifiedProfile?.nmc_licensed ?? false,
    currentZone: currentZoneId && currentZoneName ? { id: currentZoneId, name: currentZoneName } : null,
  };

  const blockedReasons = getBlockedReasons(profile, client.zone_id);

  if (blockedReasons.length > 0) {
    redirect(
      `/visits/new?error=${encodeURIComponent(`This provider isn't eligible for this client: ${blockedReasons.join("; ")}`)}`,
    );
  }

  const { data: carePlan, error: carePlanError } = await supabase
    .from("care_plan")
    .select("id")
    .eq("client_id", clientId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (carePlanError || !carePlan) {
    redirect(
      `/visits/new?error=${encodeURIComponent("This client has no care plan yet — add one before scheduling a visit.")}`,
    );
  }

  const { error: visitError } = await supabase.from("visit").insert({
    client_id: clientId,
    provider_id: providerId,
    care_plan_id: carePlan.id,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
  });

  if (visitError) {
    redirect(`/visits/new?error=${encodeURIComponent(visitError.message)}`);
  }

  redirect("/visits/new?visitScheduled=1");
}
