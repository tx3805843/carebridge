// Edge Function: whatsapp-webhook
// Public endpoint registered with Meta as the WhatsApp Cloud API webhook.
// GET handles the verify handshake (hub.challenge); POST receives inbound messages
// and delivery-status updates, logs them to whatsapp_message_log, and routes inbound
// text (e.g. safety-button presses, rating replies) to the relevant domain handler.
// TODO: verify X-Hub-Signature-256 against WHATSAPP_APP_SECRET before trusting payload.

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";

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

  const payload = await req.json().catch(() => null);
  if (!payload) {
    return new Response(JSON.stringify({ error: "invalid payload" }), { status: 400 });
  }

  // TODO: verify signature, persist to whatsapp_message_log, route inbound events.

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
