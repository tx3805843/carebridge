/**
 * Domain 8 — Billing & Financial Controls. Phase 1 minimum only: `subscription`, `invoice`,
 * `payment` are generated from live schema (see generated.ts). `prepaid_wallet` and
 * `expense_approval` are Phase 3 scope (roadmap "Financial controls" epic) and have no
 * schema yet — no placeholder types for them here until that phase builds them.
 */
import type { Database } from "./generated";

export type Subscription = Database["public"]["Tables"]["subscription"]["Row"];
export type SubscriptionInsert = Database["public"]["Tables"]["subscription"]["Insert"];
export type InvoiceStatus = Database["public"]["Tables"]["invoice"]["Row"]["status"];
export type Invoice = Database["public"]["Tables"]["invoice"]["Row"];
export type InvoiceInsert = Database["public"]["Tables"]["invoice"]["Insert"];
export type PaymentStatus = Database["public"]["Tables"]["payment"]["Row"]["status"];
export type Payment = Database["public"]["Tables"]["payment"]["Row"];
export type PaymentInsert = Database["public"]["Tables"]["payment"]["Insert"];
