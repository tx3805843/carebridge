"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { notifyEscalationOpened, notifyVisitComplete } from "@/lib/whatsapp";

const CONCERN_SEVERITIES = new Set(["high", "medium", "low"]);

export async function logVisitOutcome(visitId: string, formData: FormData) {
  const arrivedAt = String(formData.get("arrivedAt") ?? "");

  if (!arrivedAt) {
    redirect(`/visits/${visitId}/log?error=${encodeURIComponent("Arrival time is required.")}`);
  }

  const clientSafe = String(formData.get("clientSafe") ?? "");

  if (clientSafe !== "yes" && clientSafe !== "no") {
    redirect(
      `/visits/${visitId}/log?error=${encodeURIComponent("Please answer whether the client is safe right now.")}`,
    );
  }

  const taskDescriptions = formData.getAll("taskDescription").map(String).map((task) => task.trim()).filter(Boolean);

  const observationTypes = formData.getAll("observationType").map(String);
  const observationValues = formData.getAll("observationValue").map(String);
  const observations = observationTypes
    .map((type, index) => ({ type: type.trim(), value: (observationValues[index] ?? "").trim() }))
    .filter((observation) => observation.type && observation.value);

  const escalationReasonInput = String(formData.get("escalationReason") ?? "").trim();
  const submittedSeverity = String(formData.get("escalationSeverity") ?? "");

  let escalationToCreate: { severity: string; reason: string } | null = null;

  if (clientSafe === "no") {
    if (!escalationReasonInput) {
      redirect(
        `/visits/${visitId}/log?error=${encodeURIComponent("A reason is required when the client is not safe.")}`,
      );
    }

    // Severity is forced to critical here regardless of anything submitted — a submitted
    // escalationSeverity value on this branch (there shouldn't be one from the real UI, but a
    // direct/bypassed request could send one) is never read, let alone trusted.
    escalationToCreate = { severity: "critical", reason: escalationReasonInput };
  } else {
    const concernFlagged = formData.get("concernFlagged") === "on";

    if (concernFlagged) {
      if (!CONCERN_SEVERITIES.has(submittedSeverity) || !escalationReasonInput) {
        redirect(
          `/visits/${visitId}/log?error=${encodeURIComponent("Severity (high, medium, or low) and a reason are required to report a concern.")}`,
        );
      }

      escalationToCreate = { severity: submittedSeverity, reason: escalationReasonInput };
    }
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

  if (escalationToCreate) {
    const { error: escalationError } = await supabase.from("escalation").insert({
      client_id: visit.client_id,
      visit_id: visitId,
      severity: escalationToCreate.severity,
      reason: escalationToCreate.reason,
    });

    if (escalationError) {
      redirect(`/visits/${visitId}/log?error=${encodeURIComponent(escalationError.message)}`);
    }

    await notifyEscalationOpened(supabase, escalationToCreate.severity);
  }

  const { error: statusError } = await supabase.from("visit").update({ status: "completed" }).eq("id", visitId);

  if (statusError) {
    redirect(`/visits/${visitId}/log?error=${encodeURIComponent(statusError.message)}`);
  }

  await notifyVisitComplete(supabase, visit.client_id);

  redirect(`/visits/log?logged=${visitId}`);
}
