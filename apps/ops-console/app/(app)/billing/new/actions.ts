"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const CURRENCIES = ["GHS", "USD", "GBP", "EUR"];

export async function createSubscription(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  const planCode = String(formData.get("planCode") ?? "").trim();
  const currency = String(formData.get("currency") ?? "");
  const amount = String(formData.get("amount") ?? "");
  const billingInterval = String(formData.get("billingInterval") ?? "monthly");

  if (!clientId || !planCode || !CURRENCIES.includes(currency) || !amount || Number(amount) <= 0) {
    redirect(
      `/billing/new?error=${encodeURIComponent("Client, plan code, currency, and a positive amount are all required.")}`,
    );
  }

  const supabase = await createClient();

  const { data: subscription, error } = await supabase
    .from("subscription")
    .insert({
      client_id: clientId,
      plan_code: planCode,
      currency,
      amount: Number(amount),
      billing_interval: billingInterval,
    })
    .select("id")
    .single();

  if (error || !subscription) {
    redirect(`/billing/new?error=${encodeURIComponent(error?.message ?? "Failed to create subscription.")}`);
  }

  redirect(`/billing/${subscription.id}?created=1`);
}
