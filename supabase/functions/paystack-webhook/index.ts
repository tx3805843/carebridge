// Edge Function: paystack-webhook
// Public endpoint registered with Paystack as the transaction webhook. Every POST is
// signature-verified (X-Paystack-Signature: HMAC-SHA512 over the raw body, keyed with
// PAYSTACK_SECRET_KEY — Paystack's own scheme, no separate webhook secret) before its
// payload is trusted at all. Fails closed (500) if the key isn't configured, mirroring
// whatsapp-webhook's X-Hub-Signature-256 pattern exactly, just with SHA-512/hex instead of
// HMAC-SHA-256.
//
// On `charge.success`, finds the matching `payment` row by (processor='paystack',
// processor_reference=data.reference) — that reference is one we generated ourselves at
// invoice-generation time (apps/ops-console/app/billing/[id]/actions.ts), not something
// Paystack invents, so it's a safe join key. Marks the payment succeeded and its invoice
// paid, then best-effort WhatsApp-notifies every billing-responsible sponsor for that
// client — implemented natively here (not imported from apps/ops-console/lib/whatsapp.ts,
// which is Next.js-only) exactly like credential-expiry-cron's own notify() does.
//
// This function only ever UPDATEs an existing payment/invoice row, never INSERTs one — the
// row is always first created by a real staff session (the "generate invoice" action), so
// unlike notification/credential_verification_event, payment/invoice's `created_by not null
// default auth.uid()` never has to resolve for this service-role-only caller. Same design
// note as the Domain 8 migration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const PAYMENT_RECEIVED_TEMPLATE = "payment_received";

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!PAYSTACK_SECRET_KEY || !header) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const computed = bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return computed === header;
}

async function sendWhatsappTemplate(to: string, templateName: string): Promise<string | null> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return null;
  const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: "en" } },
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { messages?: { id: string }[] };
  return body.messages?.[0]?.id ?? null;
}

async function notifyBillingResponsibleSponsors(supabase: ReturnType<typeof createClient>, clientId: string) {
  const { data: relationships } = await supabase
    .from("client_relationship")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("is_billing_responsible", true);

  const sponsorIds = (relationships ?? []).map((r) => r.sponsor_id);
  if (sponsorIds.length === 0) return;

  const { data: sponsors } = await supabase.from("family_sponsor").select("user_id").in("id", sponsorIds);
  const userIds = (sponsors ?? []).map((s) => s.user_id);
  if (userIds.length === 0) return;

  const { data: users } = await supabase.from("user").select("id, phone").in("id", userIds);

  for (const user of users ?? []) {
    const { data: notification } = await supabase
      .from("notification")
      .insert({ user_id: user.id, channel: "whatsapp", template_id: PAYMENT_RECEIVED_TEMPLATE })
      .select("id")
      .single();
    if (!notification) continue;

    const messageId = user.phone ? await sendWhatsappTemplate(user.phone, PAYMENT_RECEIVED_TEMPLATE) : null;
    await supabase.from("whatsapp_message_log").insert({
      to_phone: user.phone ?? "unknown",
      template_name: PAYMENT_RECEIVED_TEMPLATE,
      status: messageId ? "sent" : "failed",
      wa_message_id: messageId,
    });
    if (messageId) {
      await supabase.from("notification").update({ sent_at: new Date().toISOString() }).eq("id", notification.id);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (!PAYSTACK_SECRET_KEY) {
    console.error("PAYSTACK_SECRET_KEY not configured — refusing to trust any inbound payload.");
    return new Response(JSON.stringify({ error: "webhook not configured" }), { status: 500 });
  }

  const rawBody = await req.text();
  const signatureValid = await verifySignature(rawBody, req.headers.get("X-Paystack-Signature"));

  if (!signatureValid) {
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 });
  }

  const payload = JSON.parse(rawBody) as { event?: string; data?: { reference?: string; status?: string } };
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (payload.event === "charge.success" && payload.data?.reference) {
    const { data: payment } = await supabase
      .from("payment")
      .select("id, invoice_id, status")
      .eq("processor", "paystack")
      .eq("processor_reference", payload.data.reference)
      .maybeSingle();

    if (payment && payment.status !== "succeeded") {
      const nowIso = new Date().toISOString();
      await supabase.from("payment").update({ status: "succeeded", paid_at: nowIso }).eq("id", payment.id);

      const { data: invoice } = await supabase
        .from("invoice")
        .update({ status: "paid", paid_at: nowIso })
        .eq("id", payment.invoice_id)
        .select("client_id")
        .single();

      if (invoice) {
        await notifyBillingResponsibleSponsors(supabase, invoice.client_id);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
});
