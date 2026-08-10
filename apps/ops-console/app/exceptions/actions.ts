"use server";

import { redirect } from "next/navigation";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CRITICAL_RESOLVER_ROLE_SLUGS, OUTCOME_CATEGORIES } from "./constants";

const OUTCOME_CATEGORY_VALUES = new Set<string>(OUTCOME_CATEGORIES.map((category) => category.value));

function backToCase(escalationId: string, params: Record<string, string>) {
  const search = new URLSearchParams({ case: escalationId, ...params });
  redirect(`/exceptions?${search.toString()}`);
}

export async function assignEscalation(escalationId: string, formData: FormData) {
  await requireStaffUser();
  const assigneeId = String(formData.get("assigneeId") ?? "").trim();
  if (!assigneeId) backToCase(escalationId, { error: "Choose someone to assign this case to." });

  const supabase = await createClient();
  const { error } = await supabase
    .from("escalation")
    .update({ assigned_to: assigneeId })
    .eq("id", escalationId);

  if (error) backToCase(escalationId, { error: error.message });
  backToCase(escalationId, { assigned: "1" });
}

export async function acknowledgeEscalation(escalationId: string, _formData: FormData) {
  const staffUser = await requireStaffUser();
  const supabase = await createClient();

  const { data: escalation } = await supabase
    .from("escalation")
    .select("status")
    .eq("id", escalationId)
    .single();

  if (!escalation || escalation.status !== "open") {
    backToCase(escalationId, { error: "This case is no longer open." });
  }

  const { error } = await supabase
    .from("escalation")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by: staffUser.id })
    .eq("id", escalationId);

  if (error) backToCase(escalationId, { error: error.message });
  backToCase(escalationId, { acknowledged: "1" });
}

// Governed resolution — the UX review's P0 fix. A critical case can no longer be closed with
// an empty note by anyone with a login: it needs a structured outcome, a real resolution note,
// and a resolver with clinical authority. Severity and the resolver's role are both re-read
// from the database here rather than trusted from the client, matching the RLS-not-role-alone
// posture CLAUDE.md requires everywhere else in this app.
export async function resolveEscalation(escalationId: string, formData: FormData) {
  const staffUser = await requireStaffUser();
  const outcomeCategory = String(formData.get("outcomeCategory") ?? "").trim();
  const resolutionNotes = String(formData.get("resolutionNotes") ?? "").trim();

  const supabase = await createClient();

  const { data: escalation } = await supabase
    .from("escalation")
    .select("severity, status")
    .eq("id", escalationId)
    .single();

  if (!escalation) backToCase(escalationId, { error: "Case not found." });
  if (escalation!.status === "resolved") backToCase(escalationId, { error: "This case is already resolved." });

  const isCritical = escalation!.severity === "critical";

  if (isCritical && !CRITICAL_RESOLVER_ROLE_SLUGS.includes(staffUser.roleSlug)) {
    backToCase(escalationId, {
      error: "Only the Clinical Director or an admin can resolve a critical case.",
    });
  }

  if (isCritical && (!OUTCOME_CATEGORY_VALUES.has(outcomeCategory) || resolutionNotes.length === 0)) {
    backToCase(escalationId, {
      error: "Critical cases require an outcome category and a resolution note before they can close.",
    });
  }

  if (outcomeCategory && !OUTCOME_CATEGORY_VALUES.has(outcomeCategory)) {
    backToCase(escalationId, { error: "Choose a valid outcome category." });
  }

  const { error } = await supabase
    .from("escalation")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: staffUser.id,
      outcome_category: outcomeCategory || null,
      resolution_notes: resolutionNotes || null,
    })
    .eq("id", escalationId);

  if (error) backToCase(escalationId, { error: error.message });
  redirect("/exceptions?resolved=1");
}
