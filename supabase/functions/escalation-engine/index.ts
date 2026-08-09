// Edge Function: escalation-engine
// Triggered by DB webhook on observation/visit_checkin inserts (and a periodic cron
// backstop). Evaluates active alert_rule rows against the incoming record; on match,
// writes an `escalation` row and dispatches a WhatsApp/SMS alert to the coordinator on duty.
// TODO: wire Supabase client + @carebridge/whatsapp once packages/db schema lands.

Deno.serve(async (req: Request) => {
  const payload = await req.json().catch(() => null);

  if (!payload) {
    return new Response(JSON.stringify({ error: "invalid payload" }), { status: 400 });
  }

  // TODO: match payload.record against alert_rule, insert escalation, notify.

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
