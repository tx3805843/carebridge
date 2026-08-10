"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

export async function updateVerifiedProfile(providerId: string, formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("verified_profile")
    .update({
      id_verified: formData.get("idVerified") === "on",
      nmc_licensed: formData.get("nmcLicensed") === "on",
      background_checked: formData.get("backgroundChecked") === "on",
      training_current: formData.get("trainingCurrent") === "on",
    })
    .eq("provider_id", providerId);

  if (error) {
    redirect(`/providers/${providerId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/providers/${providerId}?updated=profile`);
}
