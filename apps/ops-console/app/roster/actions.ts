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

  const { error } = await supabase
    .from("roster")
    .insert({ provider_id: providerId, zone_id: zoneId, week_starting: weekStarting });

  if (error) {
    redirect(`/roster?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/roster?added=1");
}
