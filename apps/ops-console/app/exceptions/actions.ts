"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function acknowledgeEscalation(escalationId: string, _formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { error } = await supabase
    .from("escalation")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by: user.id })
    .eq("id", escalationId);

  if (error) {
    redirect(`/exceptions?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/exceptions?acknowledged=1");
}

export async function resolveEscalation(escalationId: string, formData: FormData) {
  const resolutionNotes = String(formData.get("resolutionNotes") ?? "").trim();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { error } = await supabase
    .from("escalation")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
      resolution_notes: resolutionNotes || null,
    })
    .eq("id", escalationId);

  if (error) {
    redirect(`/exceptions?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/exceptions?resolved=1");
}
