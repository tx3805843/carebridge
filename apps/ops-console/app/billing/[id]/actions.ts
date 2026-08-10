"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createPaymentLink } from "@/lib/payments";
import { notifyInvoiceReady } from "@/lib/whatsapp";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function generateInvoice(subscriptionId: string, _formData: FormData) {
  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from("subscription")
    .select("id, client_id, currency, amount, plan_code")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (!subscription) {
    redirect(`/billing?error=${encodeURIComponent("Subscription not found.")}`);
  }

  const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoice")
    .insert({
      client_id: subscription.client_id,
      subscription_id: subscription.id,
      amount: subscription.amount,
      currency: subscription.currency,
      status: "draft",
      due_at: dueAt,
    })
    .select("id")
    .single();

  if (invoiceError || !invoice) {
    redirect(
      `/billing/${subscriptionId}?error=${encodeURIComponent(invoiceError?.message ?? "Failed to create invoice.")}`,
    );
  }

  // Billing-responsible sponsor's email is required by Paystack's initialize-transaction API;
  // if none is on file yet, we still record the invoice + a linkless pending payment rather
  // than blocking invoice creation on it — staff can add the payment link manually later.
  const { data: billingRelationships } = await supabase
    .from("client_relationship")
    .select("sponsor_id")
    .eq("client_id", subscription.client_id)
    .eq("is_billing_responsible", true);

  const sponsorIds = (billingRelationships ?? []).map((r) => r.sponsor_id);
  const { data: sponsors } =
    sponsorIds.length > 0 ? await supabase.from("family_sponsor").select("user_id").in("id", sponsorIds) : { data: [] };
  const sponsorUserIds = (sponsors ?? []).map((s) => s.user_id);
  const { data: sponsorUsers } =
    sponsorUserIds.length > 0
      ? await supabase.from("user").select("email").in("id", sponsorUserIds)
      : { data: [] };
  const billingEmail = sponsorUsers?.find((u) => u.email)?.email ?? null;

  const reference = randomUUID();
  let paymentLink = null as Awaited<ReturnType<typeof createPaymentLink>>;

  if (billingEmail) {
    try {
      paymentLink = await createPaymentLink({
        amount: subscription.amount,
        currency: subscription.currency,
        reference,
        email: billingEmail,
        productName: `CareBridge — ${subscription.plan_code}`,
        successUrl: `${APP_URL}/billing/${subscriptionId}?paid=1`,
        cancelUrl: `${APP_URL}/billing/${subscriptionId}`,
      });
    } catch (linkError) {
      // Payment-processor account setup (Paystack/Stripe) is a parallel-track business item,
      // not something invoice generation should hard-fail on — record the attempt and move on.
      console.error("createPaymentLink failed:", linkError);
    }
  }

  const { error: paymentError } = await supabase.from("payment").insert({
    invoice_id: invoice.id,
    processor: subscription.currency === "GHS" ? "paystack" : "stripe",
    processor_reference: paymentLink?.reference ?? reference,
    payment_link_url: paymentLink?.url ?? null,
    amount: subscription.amount,
    currency: subscription.currency,
    status: "pending",
  });

  if (paymentError) {
    redirect(
      `/billing/${subscriptionId}?error=${encodeURIComponent(`Invoice created but payment record failed: ${paymentError.message}`)}`,
    );
  }

  const { error: statusError } = await supabase.from("invoice").update({ status: "sent" }).eq("id", invoice.id);

  if (statusError) {
    redirect(`/billing/${subscriptionId}?error=${encodeURIComponent(statusError.message)}`);
  }

  await notifyInvoiceReady(supabase, subscription.client_id);

  redirect(`/billing/${subscriptionId}?generated=1`);
}
