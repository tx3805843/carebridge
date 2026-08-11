// Edge Function: credential-expiry-cron
// Scheduled daily via pg_cron + pg_net (see supabase/migrations for the schedule) against
// this function's own URL, authenticated with a dedicated CRON_SECRET bearer token — not the
// Supabase service-role key, so a leaked schedule secret can't do more than trigger this one
// run. Fails closed (401/500) exactly like whatsapp-webhook's signature check, just simpler:
// this is an internal trigger, not a payload from an external party, so a static shared
// secret is the right level of protection (no HMAC-over-body needed).
//
// CLAUDE.md guardrail this implements: "Credential expiry is enforced by a cron Edge
// Function, not a UI reminder. NMC PIN/AIN expire every 12 months: flag within 30 days,
// auto-suspend scheduling eligibility on lapse."
//
// As of Increment D2 (see docs/superpowers/specs/2026-08-11-provider-verification-override-d2-design.md),
// this function no longer computes nmc_licensed itself. It only does the "flag within 30
// days" / "auto-expire lapsed credentials" work below — the UPDATE that auto-expires a
// credential fires internal.trg_recompute_verified_profile (a Postgres trigger, same
// transaction), which recomputes all four verified_profile signals from evidence, applying
// any active governed override, and is the single authoritative implementation shared with
// the ops-console app's own writes. This function used to duplicate that computation in JS;
// removed to avoid two independent implementations of the same eligibility logic drifting
// apart. To detect "newly suspended" for notification purposes, this function now snapshots
// verified_profile.nmc_licensed before its own updates and diffs against the value after —
// reading the trigger's output, not recomputing it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const EXPIRY_WARNING_DAYS = 30;
const CREDENTIAL_EXPIRING_SOON_TEMPLATE = "credential_expiring_soon";

async function sendWhatsappTemplate(to: string, templateName: string): Promise<string | null> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return null;
  }
  const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: "en" } },
    }),
  });
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as { messages?: { id: string }[] };
  return body.messages?.[0]?.id ?? null;
}

async function notify(
  supabase: ReturnType<typeof createClient>,
  recipients: { id: string; phone: string | null }[],
  templateName: string,
) {
  for (const recipient of recipients) {
    const { data: notification } = await supabase
      .from("notification")
      .insert({ user_id: recipient.id, channel: "whatsapp", template_id: templateName })
      .select("id")
      .single();

    if (!notification) continue;

    const messageId = recipient.phone ? await sendWhatsappTemplate(recipient.phone, templateName) : null;

    await supabase.from("whatsapp_message_log").insert({
      to_phone: recipient.phone ?? "unknown",
      template_name: templateName,
      status: messageId ? "sent" : "failed",
      wa_message_id: messageId,
    });

    if (messageId) {
      await supabase.from("notification").update({ sent_at: new Date().toISOString() }).eq("id", notification.id);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET not configured — refusing to run.");
    return new Response(JSON.stringify({ error: "not configured" }), { status: 500 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const warningCutoff = new Date(today.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // ── 0. Snapshot nurse verified_profile.nmc_licensed BEFORE this run's updates ─────────
  const { data: nurseRole } = await supabase.from("role").select("id").eq("slug", "nurse").single();
  const { data: nurseUsers } = nurseRole
    ? await supabase.from("user").select("id, phone").eq("role_id", nurseRole.id)
    : { data: [] };
  const nurseUserIds = (nurseUsers ?? []).map((u) => u.id);

  const { data: nurseProviders } =
    nurseUserIds.length > 0
      ? await supabase.from("provider").select("id, user_id").in("user_id", nurseUserIds)
      : { data: [] };

  const { data: beforeProfiles } =
    (nurseProviders ?? []).length > 0
      ? await supabase
          .from("verified_profile")
          .select("provider_id, nmc_licensed")
          .in(
            "provider_id",
            (nurseProviders ?? []).map((p) => p.id),
          )
      : { data: [] };
  const wasLicensedByProviderId = new Map((beforeProfiles ?? []).map((p) => [p.provider_id, p.nmc_licensed]));

  // ── 1. Flag expiring-soon / auto-expire lapsed credentials ────────────────────────────
  const { data: credentials } = await supabase
    .from("credential")
    .select("id, provider_id, status, expiry_date, credential_type:credential_type_id(slug, expiry_period_months)")
    .not("expiry_date", "is", null)
    .neq("status", "expired");

  let expiringSoon = 0;
  let autoExpired = 0;

  for (const credential of credentials ?? []) {
    const credentialType = credential.credential_type as unknown as {
      slug: string;
      expiry_period_months: number | null;
    } | null;
    if (!credentialType?.expiry_period_months) continue;

    const expiryDate = credential.expiry_date as string;

    if (expiryDate < todayIso) {
      await supabase.from("credential_verification_event").insert({
        credential_id: credential.id,
        outcome: "expired",
        notes: "Auto-expired by credential-expiry-cron (past expiry_date).",
      });
      // This UPDATE fires internal.trg_recompute_verified_profile (same transaction),
      // recomputing all four verified_profile signals for credential.provider_id.
      await supabase.from("credential").update({ status: "expired" }).eq("id", credential.id);
      autoExpired += 1;
    } else if (expiryDate <= warningCutoff) {
      expiringSoon += 1;
    }
  }

  // ── 2. Diff nurse verified_profile.nmc_licensed AFTER this run's updates ──────────────
  const { data: afterProfiles } =
    (nurseProviders ?? []).length > 0
      ? await supabase
          .from("verified_profile")
          .select("provider_id, nmc_licensed")
          .in(
            "provider_id",
            (nurseProviders ?? []).map((p) => p.id),
          )
      : { data: [] };

  const newlySuspended: { providerId: string; userId: string }[] = [];
  for (const profile of afterProfiles ?? []) {
    const wasLicensed = wasLicensedByProviderId.get(profile.provider_id) ?? false;
    if (wasLicensed && !profile.nmc_licensed) {
      const provider = (nurseProviders ?? []).find((p) => p.id === profile.provider_id);
      if (provider) newlySuspended.push({ providerId: provider.id, userId: provider.user_id });
    }
  }

  // ── 3. Notify newly-suspended providers + coordinators ────────────────────────────────
  if (newlySuspended.length > 0) {
    const { data: coordinatorRole } = await supabase.from("role").select("id").eq("slug", "coordinator").single();
    const { data: coordinators } = coordinatorRole
      ? await supabase.from("user").select("id, phone").eq("role_id", coordinatorRole.id)
      : { data: [] };

    const { data: suspendedUsers } = await supabase
      .from("user")
      .select("id, phone")
      .in(
        "id",
        newlySuspended.map((s) => s.userId),
      );

    await notify(
      supabase,
      [...(suspendedUsers ?? []), ...(coordinators ?? [])],
      CREDENTIAL_EXPIRING_SOON_TEMPLATE,
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      checked: (credentials ?? []).length,
      expiringSoon,
      autoExpired,
      suspended: newlySuspended.length,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
