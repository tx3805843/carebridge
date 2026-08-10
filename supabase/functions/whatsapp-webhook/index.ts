// Edge Function: whatsapp-webhook
// Public endpoint registered with Meta as the WhatsApp Cloud API webhook.
// GET handles the verify handshake (hub.challenge). POST receives inbound messages and
// delivery-status updates: every POST is signature-verified (X-Hub-Signature-256 against
// WHATSAPP_APP_SECRET) before its payload is trusted at all.
//
// Persistence into whatsapp_message_log, a table shaped around outbound template sends
// (to_phone, template_name, status, wa_message_id):
//   - delivery-status callbacks (Meta confirming our own earlier send progressed to
//     sent/delivered/read/failed) UPDATE the existing row by wa_message_id — a clean fit,
//     that's exactly what the status column already tracks.
//   - inbound messages (a family member texting our number) don't have an obvious home in
//     this schema — there's no direction/from-phone/body column. Pragmatic choice, not a
//     designed inbound-message table: insert a row with to_phone = the sender's number,
//     template_name = `inbound:<message type>`, status = 'delivered'. Good enough to prove
//     "we received this" and correlate by wa_message_id; a real inbound-message model (with
//     body content) is a Phase 2 concern once something actually consumes it — inbound
//     *routing* (safety-button presses, rating replies) is explicitly out of scope here,
//     those features are Phase 2/LOCKED.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const WHATSAPP_LOG_STATUSES = new Set(["queued", "sent", "delivered", "read", "failed"]);

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET || !header?.startsWith("sha256=")) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(header.slice("sha256=".length)),
    new TextEncoder().encode(rawBody),
  );
}

interface WhatsappStatus {
  id: string;
  status: string;
}

interface WhatsappMessage {
  id: string;
  from: string;
  type: string;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (!APP_SECRET) {
    console.error("WHATSAPP_APP_SECRET not configured — refusing to trust any inbound payload.");
    return new Response(JSON.stringify({ error: "webhook not configured" }), { status: 500 });
  }

  const rawBody = await req.text();
  const signatureValid = await verifySignature(rawBody, req.headers.get("X-Hub-Signature-256"));

  if (!signatureValid) {
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};

      for (const status of (value.statuses ?? []) as WhatsappStatus[]) {
        if (!WHATSAPP_LOG_STATUSES.has(status.status)) {
          continue;
        }
        await supabase.from("whatsapp_message_log").update({ status: status.status }).eq("wa_message_id", status.id);
      }

      for (const message of (value.messages ?? []) as WhatsappMessage[]) {
        await supabase.from("whatsapp_message_log").insert({
          to_phone: message.from,
          template_name: `inbound:${message.type}`,
          status: "delivered",
          wa_message_id: message.id,
        });
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
