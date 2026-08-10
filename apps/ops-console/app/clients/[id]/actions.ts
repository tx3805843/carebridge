"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTHORITY_TYPES, CONSENT_SCOPES } from "./constants";

const AUTHORITY_TYPE_VALUES = new Set<string>(AUTHORITY_TYPES.map((type) => type.value));
const CONSENT_SCOPE_VALUES = new Set<string>(CONSENT_SCOPES.map((scope) => scope.value));

export async function grantAuthority(clientId: string, formData: FormData) {
  const sponsorId = String(formData.get("sponsorId") ?? "");
  const authorityType = String(formData.get("authorityType") ?? "");
  const evidenceDocumentRef = String(formData.get("evidenceDocumentRef") ?? "").trim();
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "");
  const effectiveUntil = String(formData.get("effectiveUntil") ?? "");

  if (!sponsorId || !AUTHORITY_TYPE_VALUES.has(authorityType)) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("A sponsor and valid authority type are required.")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { error } = await supabase.from("authority_grant").insert({
    client_id: clientId,
    sponsor_id: sponsorId,
    authority_type: authorityType,
    status: "active",
    evidence_document_ref: evidenceDocumentRef || null,
    effective_from: effectiveFrom || null,
    effective_until: effectiveUntil || null,
    granted_at: new Date().toISOString(),
    granted_by: user.id,
  });

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=authority`);
}

export async function revokeAuthority(clientId: string, formData: FormData) {
  const authorityGrantId = String(formData.get("authorityGrantId") ?? "");

  if (!authorityGrantId) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Missing authority grant.")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { error } = await supabase
    .from("authority_grant")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", authorityGrantId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=authority`);
}

export async function grantConsent(clientId: string, formData: FormData) {
  const sponsorId = String(formData.get("sponsorId") ?? "");
  const scope = String(formData.get("scope") ?? "");

  if (!sponsorId || !CONSENT_SCOPE_VALUES.has(scope)) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("A sponsor and valid consent scope are required.")}`);
  }

  const supabase = await createClient();

  const { data: sponsor } = await supabase.from("family_sponsor").select("user_id").eq("id", sponsorId).maybeSingle();

  if (!sponsor) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Sponsor not found.")}`);
  }

  // consent_grant's active-row uniqueness is a PARTIAL unique index
  // (client_id, grantee_user_id, scope) where revoked_at is null (see
  // 20260809160000_domain1_identity_access.sql). supabase-js's upsert() generates a plain
  // `ON CONFLICT (columns)` clause with no WHERE predicate, which Postgres rejects as not
  // matching a partial index — so this is a plain existence-check-then-insert, not an upsert.
  // A prior revoked row for the same (client, grantee, scope) is left untouched as audit
  // history; only a fresh, unrevoked row is ever inserted.
  const { data: existing } = await supabase
    .from("consent_grant")
    .select("id")
    .eq("client_id", clientId)
    .eq("grantee_user_id", sponsor.user_id)
    .eq("scope", scope)
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) {
    redirect(`/clients/${clientId}?updated=consent`);
  }

  const { error } = await supabase.from("consent_grant").insert({
    client_id: clientId,
    grantee_user_id: sponsor.user_id,
    scope,
    granted_at: new Date().toISOString(),
  });

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=consent`);
}

export async function revokeConsent(clientId: string, formData: FormData) {
  const consentGrantId = String(formData.get("consentGrantId") ?? "");

  if (!consentGrantId) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Missing consent grant.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("consent_grant")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", consentGrantId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=consent`);
}

export async function recordConsent(clientId: string, formData: FormData) {
  const documentRef = String(formData.get("documentRef") ?? "").trim();
  const signedAt = String(formData.get("signedAt") ?? "");

  if (!documentRef) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("A document reference is required.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("consent_record").insert({
    client_id: clientId,
    document_ref: documentRef,
    signed_at: signedAt || undefined,
  });

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=consent-record`);
}
