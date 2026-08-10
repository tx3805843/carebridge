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
// Two separate mechanisms, deliberately not conflated:
//   1. "Flag within 30 days" is read-only — credentials within the window are counted and
//      notified about, but their `status` is untouched (still whatever it was, e.g.
//      'verified'). Only actual expiry (expiry_date < today) auto-transitions `status` to
//      'expired', with a credential_verification_event recording why.
//   2. "Auto-suspend scheduling eligibility on lapse" is `verified_profile.nmc_licensed`,
//      recomputed from scratch every run for every nurse (self-healing: correct whether the
//      lapse just happened this run or was already sitting there from a prior one) rather
//      than incrementally patched — true iff they hold a 'verified' nmc_pin_ain credential
//      that isn't past its expiry_date. Caregivers never have an nmc_pin_ain credential, so
//      they're naturally excluded without special-casing.
// Newly-suspended providers (nmc_licensed flips true -> false this run) get a best-effort
// WhatsApp notification (provider + coordinators) — implemented natively here rather than
// importing apps/ops-console/lib/whatsapp.ts, which is Next.js-server-only code that can't
// run in this Deno runtime.

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
      await supabase.from("credential").update({ status: "expired" }).eq("id", credential.id);
      autoExpired += 1;
    } else if (expiryDate <= warningCutoff) {
      expiringSoon += 1;
    }
  }

  // ── 2. Recompute NMC scheduling eligibility for every nurse, from scratch ─────────────
  const { data: nurseRole } = await supabase.from("role").select("id").eq("slug", "nurse").single();
  const { data: nmcCredentialType } = await supabase
    .from("credential_type")
    .select("id")
    .eq("slug", "nmc_pin_ain")
    .single();

  let suspended = 0;
  const newlySuspended: { providerId: string; userId: string }[] = [];

  if (nurseRole && nmcCredentialType) {
    const { data: nurseUsers } = await supabase.from("user").select("id").eq("role_id", nurseRole.id);
    const nurseUserIds = (nurseUsers ?? []).map((u) => u.id);

    const { data: nurseProviders } =
      nurseUserIds.length > 0
        ? await supabase.from("provider").select("id, user_id").in("user_id", nurseUserIds)
        : { data: [] };

    for (const provider of nurseProviders ?? []) {
      const { data: validNmc } = await supabase
        .from("credential")
        .select("id")
        .eq("provider_id", provider.id)
        .eq("credential_type_id", nmcCredentialType.id)
        .eq("status", "verified")
        .or(`expiry_date.is.null,expiry_date.gte.${todayIso}`)
        .limit(1)
        .maybeSingle();

      const eligible = Boolean(validNmc);

      const { data: existingProfile } = await supabase
        .from("verified_profile")
        .select("nmc_licensed")
        .eq("provider_id", provider.id)
        .maybeSingle();

      if (existingProfile && existingProfile.nmc_licensed !== eligible) {
        await supabase.from("verified_profile").update({ nmc_licensed: eligible }).eq("provider_id", provider.id);

        if (!eligible) {
          suspended += 1;
          newlySuspended.push({ providerId: provider.id, userId: provider.user_id });
        }
      }
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
    JSON.stringify({ ok: true, checked: (credentials ?? []).length, expiringSoon, autoExpired, suspended }),
    { headers: { "content-type": "application/json" } },
  );
});
