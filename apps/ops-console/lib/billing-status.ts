// Pure logic for the billing list/detail refresh (Increment D4): status label/variant maps
// and derived "overdue"/"needs attention" states. invoice.status = 'overdue' is never
// written anywhere in this codebase (the column allows it, nothing sets it) —
// isInvoiceOverdue computes it read-time instead, same "derive from real state, don't trust
// a manual flag" precedent D1 used for provider verification badges. Reused by
// app/billing/page.tsx and app/billing/[id]/page.tsx.

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

export const SUBSCRIPTION_STATUS_VARIANT: Record<string, "success" | "warning" | "neutral"> = {
  active: "success",
  paused: "warning",
  cancelled: "neutral",
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export const INVOICE_STATUS_VARIANT: Record<
  string,
  "success" | "warning" | "critical" | "information" | "neutral"
> = {
  draft: "neutral",
  sent: "information",
  paid: "success",
  overdue: "critical",
  void: "neutral",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  succeeded: "Succeeded",
  failed: "Failed",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_VARIANT: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  pending: "warning",
  succeeded: "success",
  failed: "critical",
  refunded: "neutral",
};

export interface InvoiceOverdueInput {
  status: string;
  dueAt: string | null; // date-only (YYYY-MM-DD) or full ISO — compared as date-only
}

// The one true owner of the overdue computation — called by getInvoiceDisplayStatus and
// getAttentionReasons below, so the two can never disagree.
export function isInvoiceOverdue(invoice: InvoiceOverdueInput, todayIso: string): boolean {
  if (invoice.status !== "sent" || !invoice.dueAt) return false;
  return invoice.dueAt.slice(0, 10) < todayIso;
}

// Delivery-state badge value: "overdue" if computed true, otherwise the literal stored
// status. Never reads a literal 'overdue' off the column, since nothing ever writes one.
export function getInvoiceDisplayStatus(invoice: InvoiceOverdueInput, todayIso: string): string {
  return isInvoiceOverdue(invoice, todayIso) ? "overdue" : invoice.status;
}

export interface PaymentForGuard {
  status: string;
  createdAt: string;
}

function latestByCreatedAt<T extends { createdAt: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) => (row.createdAt > latest.createdAt ? row : latest));
}

// Duplicate-protection guard for "Send payment request": true when there's no payment yet,
// or the most recent one failed (a legitimate retry) — false once the latest payment is
// pending or succeeded, so the same invoice can't be sent twice. Shared by the button's
// render condition (app/billing/[id]/page.tsx) and sendPaymentRequest's own server-side
// re-check (app/billing/[id]/actions.ts), so the two can't drift.
export function canSendPaymentRequest(payments: PaymentForGuard[]): boolean {
  const latest = latestByCreatedAt(payments);
  return latest === null || latest.status === "failed";
}

export interface AttentionCheckInvoice {
  status: string;
  dueAt: string | null;
  payments: PaymentForGuard[];
}

export interface AttentionCheckInput {
  subscriptionStatus: string;
  invoices: AttentionCheckInvoice[];
  todayIso: string;
}

// Returns every reason this subscription needs attention — empty array means fine.
export function getAttentionReasons(input: AttentionCheckInput): string[] {
  const reasons: string[] = [];

  if (input.subscriptionStatus === "active" && input.invoices.length === 0) {
    reasons.push("never invoiced");
  }

  if (input.invoices.some((invoice) => isInvoiceOverdue(invoice, input.todayIso))) {
    reasons.push("invoice overdue");
  }

  if (input.invoices.some((invoice) => latestByCreatedAt(invoice.payments)?.status === "failed")) {
    reasons.push("payment failed");
  }

  return reasons;
}
