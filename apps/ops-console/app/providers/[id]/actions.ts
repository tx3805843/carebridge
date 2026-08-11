"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireStaffUser } from "@/lib/auth";

const VERIFICATION_STATUSES = ["unverified", "pending", "verified", "expired", "rejected"];

export async function addCredential(providerId: string, formData: FormData) {
  const credentialTypeId = String(formData.get("credentialTypeId") ?? "");
  const issuingAuthority = String(formData.get("issuingAuthority") ?? "").trim();
  const expiryDate = String(formData.get("expiryDate") ?? "");
  const evidenceDocumentRef = String(formData.get("evidenceDocumentRef") ?? "").trim();

  if (!credentialTypeId || !issuingAuthority) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("Credential type and issuing authority are required.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("credential").insert({
    provider_id: providerId,
    credential_type_id: credentialTypeId,
    issuing_authority: issuingAuthority,
    expiry_date: expiryDate || null,
    evidence_document_ref: evidenceDocumentRef || null,
  });

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?added=credential`);
}

export async function logCredentialVerification(providerId: string, formData: FormData) {
  const credentialId = String(formData.get("credentialId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!credentialId || !VERIFICATION_STATUSES.includes(outcome)) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("A credential and valid outcome are required.")}`);
  }

  const supabase = await createClient();

  const { error: eventError } = await supabase.from("credential_verification_event").insert({
    credential_id: credentialId,
    outcome,
    notes: notes || null,
  });

  if (eventError) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(eventError.message)}`);
  }

  const { error: statusError } = await supabase.from("credential").update({ status: outcome }).eq("id", credentialId);

  if (statusError) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(statusError.message)}`);
  }

  redirect(`/providers/${providerId}?added=verification`);
}

export async function addIdentityVerification(providerId: string, formData: FormData) {
  const vendor = String(formData.get("vendor") ?? "");
  const status = String(formData.get("status") ?? "");
  const verifiedAt = String(formData.get("verifiedAt") ?? "");

  if (!["smile_id", "youverify"].includes(vendor) || !VERIFICATION_STATUSES.includes(status)) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("A valid vendor and status are required.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("identity_verification").insert({
    provider_id: providerId,
    vendor,
    status,
    verified_at: verifiedAt || null,
  });

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?added=identity`);
}

export async function addBackgroundCheck(providerId: string, formData: FormData) {
  const status = String(formData.get("status") ?? "");
  const documentRef = String(formData.get("documentRef") ?? "").trim();
  const expiresAt = String(formData.get("expiresAt") ?? "");

  if (!VERIFICATION_STATUSES.includes(status) || !documentRef) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("Status and document reference are required.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("background_check").insert({
    provider_id: providerId,
    status,
    document_ref: documentRef,
    expires_at: expiresAt || null,
  });

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?added=background`);
}

export async function addTrainingRecord(providerId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const cpdPoints = String(formData.get("cpdPoints") ?? "0");
  const completedAt = String(formData.get("completedAt") ?? "");

  if (!title) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("Training title is required.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("training_record").insert({
    provider_id: providerId,
    title,
    cpd_points: Number(cpdPoints) || 0,
    completed_at: completedAt || undefined,
  });

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?added=training`);
}

const EMPLOYMENT_STATUSES = ["active", "on_leave", "departed"];

export async function updateEmploymentStatus(providerId: string, formData: FormData) {
  const employmentStatus = String(formData.get("employmentStatus") ?? "");
  const departureReason = String(formData.get("departureReason") ?? "").trim();

  if (!EMPLOYMENT_STATUSES.includes(employmentStatus)) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("Invalid employment status.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("provider")
    .update({
      employment_status: employmentStatus,
      departed_at: employmentStatus === "departed" ? new Date().toISOString() : null,
      departure_reason: employmentStatus === "departed" ? departureReason || null : null,
    })
    .eq("id", providerId);

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?updated=employment status`);
}

// Matches CRITICAL_RESOLVER_ROLE_SLUGS in apps/ops-console/app/exceptions/constants.ts —
// same bar for a credentialing-eligibility override as for resolving a critical escalation.
const OVERRIDE_APPROVER_ROLE_SLUGS = ["clinical_director", "admin"];

const OVERRIDE_SIGNALS = ["id_verified", "nmc_licensed", "background_checked", "training_current"];

export const OVERRIDE_SIGNAL_LABEL: Record<string, string> = {
  id_verified: "ID verification",
  nmc_licensed: "NMC PIN/AIN",
  background_checked: "Background check",
  training_current: "Training",
};

// Defense-in-depth, matching apps/ops-console/app/exceptions/actions.ts#resolveEscalation's
// own posture: verification_override's RLS (internal.is_credentialing_approver()) is the
// real gate — this check exists so a non-approver gets a specific, friendly error instead of
// an opaque RLS failure.
export async function createVerificationOverride(providerId: string, formData: FormData) {
  const staffUser = await requireStaffUser();

  if (!OVERRIDE_APPROVER_ROLE_SLUGS.includes(staffUser.roleSlug)) {
    redirect(
      `/providers/${providerId}?error=${encodeURIComponent("Only the Clinical Director or an admin can create a verification override.")}`,
    );
  }

  const signal = String(formData.get("signal") ?? "");
  const overrideValue = String(formData.get("overrideValue") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const effectiveUntil = String(formData.get("effectiveUntil") ?? "");

  if (!OVERRIDE_SIGNALS.includes(signal)) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("A valid signal is required.")}`);
  }

  if (overrideValue !== "true" && overrideValue !== "false") {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("A value is required.")}`);
  }

  if (!reason) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("A reason is required.")}`);
  }

  if (!effectiveUntil) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent("An effective-until date is required.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("verification_override").insert({
    provider_id: providerId,
    signal,
    override_value: overrideValue === "true",
    reason,
    effective_until: effectiveUntil,
  });

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?added=override`);
}

export async function revokeVerificationOverride(providerId: string, overrideId: string, formData: FormData) {
  const staffUser = await requireStaffUser();

  if (!OVERRIDE_APPROVER_ROLE_SLUGS.includes(staffUser.roleSlug)) {
    redirect(
      `/providers/${providerId}?error=${encodeURIComponent("Only the Clinical Director or an admin can revoke a verification override.")}`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("verification_override")
    .update({ revoked_at: new Date().toISOString(), revoked_by: staffUser.id })
    .eq("id", overrideId);

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?updated=override`);
}
