// Edge Function: stripe-webhook
// Public endpoint registered with Stripe as the webhook endpoint. Every POST is
// signature-verified against the `Stripe-Signature` header before its payload is trusted —
// implemented by hand (Stripe's documented scheme: HMAC-SHA256 of `${timestamp}.${rawBody}`
// keyed with STRIPE_WEBHOOK_SECRET, compared to the header's `v1=` value) rather than
// pulling in the Stripe SDK, matching this project's existing DIY-HMAC style
// (whatsapp-webhook, paystack-webhook) instead of adding a new dependency for one check.
// STRIPE_WEBHOOK_SECRET is deliberately separate from STRIPE_SECRET_KEY (the API key used to
// create Checkout Sessions in apps/ops-console/lib/payments.ts) — Stripe issues a distinct
// signing secret per webhook endpoint, unlike Paystack which reuses the API secret key.
// Fails closed (500) if the webhook secret isn't configured.
//
// On `checkout.session.completed` with payment_status "paid", finds the matching `payment`
// row by (processor='stripe', processor_reference=client_reference_id) — client_reference_id
// is the reference we generated ourselves at invoice-generation time and passed to Stripe
// when creating the Checkout Session, so it's a safe join key, same pattern as Paystack's
// own `data.reference`. See paystack-webhook/index.ts for the (identical, deliberately not
// shared — Deno can't import the Next.js-only apps/ops-console/lib/whatsapp.ts, and there's
// no third runtime to share Deno-only code between these two functions either) notify logic
// and the same "UPDATE-only, never INSERT into payment/invoice" design note.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const PAYMENT_RECEIVED_TEMPLATE = "payment_received";
const TOLERANCE_SECONDS = 5 * 60;

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseSignatureHeader(header: string): { timestamp: string; v1: string } | null {
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );
  if (!parts.t || !parts.v1) return null;
  return { timestamp: parts.t, v1: parts.v1 };
}

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!STRIPE_WEBHOOK_SECRET || !header) return false;

  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(parsed.timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const computed = bytesToHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parsed.timestamp}.${rawBody}`)),
  );
  return computed === parsed.v1;
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
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not configured — refusing to trust any inbound payload.");
    return new Response(JSON.stringify({ error: "webhook not configured" }), { status: 500 });
  }

  const rawBody = await req.text();
  const signatureValid = await verifySignature(rawBody, req.headers.get("Stripe-Signature"));

  if (!signatureValid) {
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    type?: string;
    data?: { object?: { client_reference_id?: string; payment_status?: string } };
  };
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const session = payload.data?.object;
  if (payload.type === "checkout.session.completed" && session?.payment_status === "paid" && session.client_reference_id) {
    const { data: payment } = await supabase
      .from("payment")
      .select("id, invoice_id, status")
      .eq("processor", "stripe")
      .eq("processor_reference", session.client_reference_id)
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
