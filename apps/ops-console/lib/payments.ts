import "server-only";

/**
 * Thin Paystack/Stripe wrappers, same shape as lib/whatsapp.ts: return null / throw on a
 * clean, catchable condition rather than assuming live credentials exist — Paystack/Stripe
 * account setup is a parallel-track business item (like Meta WhatsApp approval), not
 * something this MVP can block app-code on. Currency picks the processor per the brief's own
 * split: Paystack for GHS, Stripe for diaspora currencies (USD/GBP/EUR).
 */

export interface PaymentLinkResult {
  processor: "paystack" | "stripe";
  reference: string;
  url: string;
}

function minorUnits(amount: number): number {
  return Math.round(amount * 100);
}

async function initializePaystackTransaction(input: {
  email: string;
  amount: number;
  currency: string;
  reference: string;
}): Promise<PaymentLinkResult | null> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return null;

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      amount: minorUnits(input.amount),
      currency: input.currency,
      reference: input.reference,
    }),
  });

  if (!res.ok) {
    throw new Error(`Paystack initialize failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { data?: { authorization_url?: string } };
  if (!body.data?.authorization_url) {
    throw new Error("Paystack initialize succeeded but returned no authorization_url");
  }

  return { processor: "paystack", reference: input.reference, url: body.data.authorization_url };
}

async function createStripeCheckoutSession(input: {
  amount: number;
  currency: string;
  productName: string;
  clientReferenceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<PaymentLinkResult | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(minorUnits(input.amount)),
    "line_items[0][price_data][product_data][name]": input.productName,
    "line_items[0][quantity]": "1",
    client_reference_id: input.clientReferenceId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Stripe checkout session failed: ${res.status} ${await res.text()}`);
  }

  const responseBody = (await res.json()) as { url?: string };
  if (!responseBody.url) {
    throw new Error("Stripe checkout session succeeded but returned no url");
  }

  return { processor: "stripe", reference: input.clientReferenceId, url: responseBody.url };
}

/**
 * Creates a payment link for an invoice. Returns null (not throw) when the relevant
 * processor has no API key configured — the caller records a pending, linkless payment row
 * rather than blocking invoice generation on a business dependency (processor account setup)
 * that's tracked separately in the roadmap, not this app's phase gate.
 */
export async function createPaymentLink(input: {
  amount: number;
  currency: string;
  reference: string;
  email: string;
  productName: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<PaymentLinkResult | null> {
  if (input.currency === "GHS") {
    return initializePaystackTransaction({
      email: input.email,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
    });
  }

  return createStripeCheckoutSession({
    amount: input.amount,
    currency: input.currency,
    productName: input.productName,
    clientReferenceId: input.reference,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
}
