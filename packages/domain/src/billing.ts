/** Domain 8 — Billing & Financial Controls. Care fees kept separate from approved third-party spend. */

export interface Subscription {
  id: string;
  clientId: string;
  planCode: string;
  status: "active" | "paused" | "cancelled";
  currency: "GHS" | "USD" | "GBP" | "EUR";
}

export interface Invoice {
  id: string;
  clientId: string;
  amount: number;
  currency: "GHS" | "USD" | "GBP" | "EUR";
  status: "draft" | "sent" | "paid" | "overdue" | "void";
  dueAt: string;
}

export interface PrepaidWallet {
  id: string;
  clientId: string;
  balance: number;
  currency: "GHS" | "USD" | "GBP" | "EUR";
}

export interface ExpenseApproval {
  id: string;
  clientId: string;
  approvedBySponsorId: string;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "declined";
}

export interface Payment {
  id: string;
  invoiceId: string | null;
  processor: "paystack" | "stripe";
  amount: number;
  currency: "GHS" | "USD" | "GBP" | "EUR";
  status: "pending" | "succeeded" | "failed" | "refunded";
}
