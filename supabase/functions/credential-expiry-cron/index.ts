// Edge Function: credential-expiry-cron
// Scheduled (pg_cron, daily). Scans `credential` rows for expiry_date within the warning
// window (30/14/1 day), sends WHATSAPP_TEMPLATES.credentialExpiringSoon, and auto-flips
// status to "expired" + suspends the provider from scheduling once expiry_date has passed.
// Hard requirement per docs/domain-model.md Part 3.1: NMC PIN/AIN expires every 12 months.
// TODO: wire Supabase client + @carebridge/whatsapp once packages/db schema lands.

Deno.serve(async (_req: Request) => {
  // TODO: query credential where expiry_date <= now() + interval, branch on window vs. expired.

  return new Response(JSON.stringify({ ok: true, checked: 0, expired: 0 }), {
    headers: { "content-type": "application/json" },
  });
});
