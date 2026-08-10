"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function logVisitOutcome(visitId: string, formData: FormData) {
  const arrivedAt = String(formData.get("arrivedAt") ?? "");

  if (!arrivedAt) {
    redirect(`/visits/${visitId}/log?error=${encodeURIComponent("Arrival time is required.")}`);
  }

  const taskDescriptions = formData.getAll("taskDescription").map(String).map((task) => task.trim()).filter(Boolean);

  const observationTypes = formData.getAll("observationType").map(String);
  const observationValues = formData.getAll("observationValue").map(String);
  const observations = observationTypes
    .map((type, index) => ({ type: type.trim(), value: (observationValues[index] ?? "").trim() }))
    .filter((observation) => observation.type && observation.value);

  const escalationFlagged = formData.get("escalationFlagged") === "on";
  const escalationSeverity = String(formData.get("escalationSeverity") ?? "");
  const escalationReason = String(formData.get("escalationReason") ?? "").trim();

  if (escalationFlagged && (!escalationSeverity || !escalationReason)) {
    redirect(
      `/visits/${visitId}/log?error=${encodeURIComponent("Escalation severity and reason are required when flagging an escalation.")}`,
    );
  }

  const supabase = await createClient();

  const { data: visit, error: visitError } = await supabase
    .from("visit")
    .select("id, client_id")
    .eq("id", visitId)
    .maybeSingle();

  if (visitError || !visit) {
    redirect(`/visits/log?error=${encodeURIComponent("Visit not found.")}`);
  }

  const { data: client } = await supabase.from("client").select("zone_id").eq("id", visit.client_id).maybeSingle();

  const { error: checkinError } = await supabase.from("visit_checkin").insert({
    visit_id: visitId,
    event: "arrived",
    occurred_at: arrivedAt,
    zone_id: client?.zone_id ?? null,
  });

  if (checkinError) {
    redirect(`/visits/${visitId}/log?error=${encodeURIComponent(checkinError.message)}`);
  }

  if (taskDescriptions.length > 0) {
    const { error: taskError } = await supabase.from("task").insert(
      taskDescriptions.map((description) => ({ visit_id: visitId, description, completed: true })),
    );

    if (taskError) {
      redirect(`/visits/${visitId}/log?error=${encodeURIComponent(taskError.message)}`);
    }
  }

  if (observations.length > 0) {
    const { error: observationError } = await supabase.from("observation").insert(
      observations.map((observation) => ({
        visit_id: visitId,
        type: observation.type,
        value: observation.value,
      })),
    );

    if (observationError) {
      redirect(`/visits/${visitId}/log?error=${encodeURIComponent(observationError.message)}`);
    }
  }

  if (escalationFlagged) {
    const { error: escalationError } = await supabase.from("escalation").insert({
      client_id: visit.client_id,
      visit_id: visitId,
      severity: escalationSeverity,
      reason: escalationReason,
    });

    if (escalationError) {
      redirect(`/visits/${visitId}/log?error=${encodeURIComponent(escalationError.message)}`);
    }
  }

  const { error: statusError } = await supabase.from("visit").update({ status: "completed" }).eq("id", visitId);

  if (statusError) {
    redirect(`/visits/${visitId}/log?error=${encodeURIComponent(statusError.message)}`);
  }

  redirect(`/visits/log?logged=${visitId}`);
}
