"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function scheduleVisit(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const scheduledStart = String(formData.get("scheduledStart") ?? "");
  const scheduledEnd = String(formData.get("scheduledEnd") ?? "");

  if (!clientId || !providerId || !scheduledStart || !scheduledEnd) {
    redirect(`/visits/new?error=${encodeURIComponent("Client, provider, and start/end times are all required.")}`);
  }

  const supabase = await createClient();

  const { data: client } = await supabase.from("client").select("status").eq("id", clientId).maybeSingle();

  if (client?.status !== "active") {
    redirect(
      `/visits/new?error=${encodeURIComponent("This client is not active — reactivate them before scheduling a visit.")}`,
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
