"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function addRosterAssignment(formData: FormData) {
  const providerId = String(formData.get("providerId") ?? "");
  const zoneId = String(formData.get("zoneId") ?? "");
  const weekStarting = String(formData.get("weekStarting") ?? "");

  if (!providerId || !zoneId || !weekStarting) {
    redirect(`/roster?error=${encodeURIComponent("Provider, zone, and week starting are all required.")}`);
  }

  const supabase = await createClient();

  // CLAUDE.md guardrail: "NMC PIN/AIN expire every 12 months... auto-suspend scheduling
  // eligibility on lapse." verified_profile.nmc_licensed is that eligibility signal,
  // recomputed nightly by the credential-expiry-cron Edge Function. Caregivers have no
  // equivalent statutory credential, so this check only applies to nurses.
  const { data: provider } = await supabase.from("provider").select("user_id").eq("id", providerId).maybeSingle();
  const { data: providerUser } = provider
    ? await supabase.from("user").select("role_id").eq("id", provider.user_id).maybeSingle()
    : { data: null };
  const { data: nurseRole } = await supabase.from("role").select("id").eq("slug", "nurse").single();

  if (providerUser && nurseRole && providerUser.role_id === nurseRole.id) {
    const { data: verifiedProfile } = await supabase
      .from("verified_profile")
      .select("nmc_licensed")
      .eq("provider_id", providerId)
      .maybeSingle();

    if (!verifiedProfile?.nmc_licensed) {
      redirect(
        `/roster?error=${encodeURIComponent("This nurse's NMC PIN/AIN isn't currently licensed (expired, lapsed, or not yet logged) — scheduling eligibility is suspended. Log a verified, unexpired NMC credential on their provider profile first.")}`,
      );
    }
  }

  const { error } = await supabase
    .from("roster")
    .insert({ provider_id: providerId, zone_id: zoneId, week_starting: weekStarting });

  if (error) {
    redirect(`/roster?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/roster?added=1");
}
