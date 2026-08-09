// Edge Function: invoice-generator
// Scheduled (pg_cron, monthly/billing-cycle) plus on-demand invocation from ops-console.
// Reads active `subscription` + approved `expense_approval` rows per client, writes
// draft `invoice` rows, and sends WHATSAPP_TEMPLATES.invoiceReady with a Paystack/Stripe
// payment link. Keeps care-fee billing separate from approved third-party spend.
// TODO: wire Supabase client + Paystack/Stripe payment-link creation once packages/db schema lands.

Deno.serve(async (req: Request) => {
  const payload = await req.json().catch(() => ({}));
  const clientId = payload?.clientId ?? null;

  // TODO: resolve billing period, aggregate subscription + expense_approval, insert invoice.

  return new Response(JSON.stringify({ ok: true, clientId, invoicesCreated: 0 }), {
    headers: { "content-type": "application/json" },
  });
});
