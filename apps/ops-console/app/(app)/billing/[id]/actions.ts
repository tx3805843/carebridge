"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createPaymentLink } from "@/lib/payments";
import { notifyInvoiceReady } from "@/lib/whatsapp";
import { formatPlanName } from "@/lib/format";
import { canSendPaymentRequest } from "@/lib/billing-status";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Record-only: no payment row, no processor call, no WhatsApp send. That's the whole point of
// the split — this used to be inseparable from sendPaymentRequest below.
export async function createDraftInvoice(subscriptionId: string, _formData: FormData) {
  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from("subscription")
    .select("id, client_id, currency, amount")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (!subscription) {
    redirect(`/billing?error=${encodeURIComponent("Subscription not found.")}`);
  }

  const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { error: invoiceError } = await supabase.from("invoice").insert({
    client_id: subscription.client_id,
    subscription_id: subscription.id,
    amount: subscription.amount,
    currency: subscription.currency,
    status: "draft",
    due_at: dueAt,
  });

  if (invoiceError) {
    redirect(`/billing/${subscriptionId}?error=${encodeURIComponent(invoiceError.message)}`);
  }

  redirect(`/billing/${subscriptionId}?draftCreated=1`);
}

// Everything generateInvoice used to do after the invoice row existed — payment record,
// processor link, invoice.status -> 'sent', WhatsApp notify — now re-callable per invoice,
// gated by a server-side re-check of canSendPaymentRequest (the UI hiding the button is a
// nicety, not the enforcement — matches every prior increment's "re-derive server-side, don't
// just trust a disabled control" precedent, e.g. C1's scheduleVisit, C3's severity lock).
export async function sendPaymentRequest(invoiceId: string, _formData: FormData) {
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("invoice")
    .select("id, subscription_id, client_id, amount, currency, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) {
    redirect(`/billing?error=${encodeURIComponent("Invoice not found.")}`);
  }

  if (invoice.status !== "draft" && invoice.status !== "sent") {
    redirect(
      `/billing/${invoice.subscription_id}?error=${encodeURIComponent("This invoice is not eligible for a payment request.")}`,
    );
  }

  const { data: existingPayments } = await supabase
    .from("payment")
    .select("status, created_at")
    .eq("invoice_id", invoiceId);

  if (!canSendPaymentRequest((existingPayments ?? []).map((p) => ({ status: p.status, createdAt: p.created_at })))) {
    redirect(
      `/billing/${invoice.subscription_id}?error=${encodeURIComponent("A payment request has already been sent for this invoice.")}`,
    );
  }

  const { data: subscription } = await supabase
    .from("subscription")
    .select("plan_code")
    .eq("id", invoice.subscription_id)
    .maybeSingle();

  // Billing-responsible sponsor's email is required by Paystack's initialize-transaction API;
  // if none is on file yet, we still record a linkless pending payment rather than blocking
  // the request on it — staff can add the payment link manually later.
  const { data: billingRelationships } = await supabase
    .from("authority_grant")
    .select("sponsor_id")
    .eq("client_id", invoice.client_id)
    .eq("authority_type", "billing_responsible")
    .eq("status", "active");

  const sponsorIds = (billingRelationships ?? []).map((r) => r.sponsor_id);
  const { data: sponsors } =
    sponsorIds.length > 0 ? await supabase.from("family_sponsor").select("user_id").in("id", sponsorIds) : { data: [] };
  const sponsorUserIds = (sponsors ?? []).map((s) => s.user_id);
  const { data: sponsorUsers } =
    sponsorUserIds.length > 0 ? await supabase.from("user").select("email").in("id", sponsorUserIds) : { data: [] };
  const billingEmail = sponsorUsers?.find((u) => u.email)?.email ?? null;

  const reference = randomUUID();
  let paymentLink = null as Awaited<ReturnType<typeof createPaymentLink>>;

  if (billingEmail) {
    try {
      paymentLink = await createPaymentLink({
        amount: invoice.amount,
        currency: invoice.currency,
        reference,
        email: billingEmail,
        productName: `CareBridge — ${formatPlanName(subscription?.plan_code)}`,
        successUrl: `${APP_URL}/billing/${invoice.subscription_id}?paid=1`,
        cancelUrl: `${APP_URL}/billing/${invoice.subscription_id}`,
      });
    } catch (linkError) {
      // Payment-processor account setup (Paystack/Stripe) is a parallel-track business item,
      // not something a payment request should hard-fail on — record the attempt and move on.
      console.error("createPaymentLink failed:", linkError);
    }
  }

  const { error: paymentError } = await supabase.from("payment").insert({
    invoice_id: invoice.id,
    processor: invoice.currency === "GHS" ? "paystack" : "stripe",
    processor_reference: paymentLink?.reference ?? reference,
    payment_link_url: paymentLink?.url ?? null,
    amount: invoice.amount,
    currency: invoice.currency,
    status: "pending",
  });

  if (paymentError) {
    // 23505 = unique_violation on payment_one_inflight_per_invoice
    // (20260812065728_payment_one_inflight_per_invoice.sql) — the real, database-enforced
    // guard against a concurrent duplicate send: the canSendPaymentRequest check above and
    // this insert are two separate round trips, so a near-simultaneous second call (a
    // double-click, or two staff tabs on the same invoice) could pass that check before this
    // insert lands. The index catches what the application-level check alone can't.
    if (paymentError.code === "23505") {
      redirect(
        `/billing/${invoice.subscription_id}?error=${encodeURIComponent("A payment request has already been sent for this invoice.")}`,
      );
    }
    redirect(
      `/billing/${invoice.subscription_id}?error=${encodeURIComponent(`Payment record failed: ${paymentError.message}`)}`,
    );
  }

  const { error: statusError } = await supabase.from("invoice").update({ status: "sent" }).eq("id", invoice.id);

  if (statusError) {
    redirect(`/billing/${invoice.subscription_id}?error=${encodeURIComponent(statusError.message)}`);
  }

  await notifyInvoiceReady(supabase, invoice.client_id);

  redirect(`/billing/${invoice.subscription_id}?generated=1`);
}
