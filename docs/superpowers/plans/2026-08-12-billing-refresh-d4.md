# Billing List/Detail Refresh (Increment D4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/billing` shows formatted currency amounts, a subscription-status badge, a Sponsor
column, and filter chips (All/Needs attention/Active/Paused/Cancelled). `/billing/[id]` shows
a "Billing sponsor" field, a Delivery-state + Processor-state badge per invoice, and the
former single "Generate invoice" action split into "Create draft invoice" (record-only) and a
per-invoice, duplicate-protected "Send payment request" (the actual payment-link/notify
side effects). No schema change.

**Architecture:** Two new pure-logic modules — `apps/ops-console/lib/billing-status.ts`
(status label/variant maps, `isInvoiceOverdue`, `getAttentionReasons`,
`canSendPaymentRequest` — same shape as `provider-verification-status.ts`/
`roster-coverage.ts`) and `apps/ops-console/lib/billing.ts` (`getBillingResponsibleSponsorName`,
a small Supabase-querying helper, same authority_grant→family_sponsor→user join
`lib/whatsapp.ts`'s private `billingResponsibleSponsorUsers` already does, duplicated rather
than shared since it selects different columns from a different module). `lib/format.ts`
gains `formatCurrency`. `/billing` (Task 4) is rewritten independently — it has no coupling to
the action split. `/billing/[id]/page.tsx` and `/billing/[id]/actions.ts` (Task 5) are
tightly coupled — the page imports `createDraftInvoice`/`sendPaymentRequest` by name from the
actions file, and the actions file's whole reason for existing is what the page renders — so
they're one task, one commit, not two independently-typecheckable steps (splitting them would
leave a real intermediate state where either file references a function the other doesn't
have yet). **Task 5 is authored directly by the controller, not delegated to an implementer
subagent** — CLAUDE.md flags "financial logic (invoicing...)" as supervisor-tier ("author or
*fully* review... never delegate a first draft to a cheaper model"), and `actions.ts` changes
when and how a real payment-link request fires, not just how it's displayed; folding the
tightly-coupled page changes into the same controller-authored task is simpler than
artificially splitting authorship mid-task. Tasks 1-4 stay worker-tier (delegated, two-stage
reviewed) since they're pure display/formatting/join logic with no behavior change to money
movement.

**Tech Stack:** Next.js App Router server components + server actions, Supabase JS client,
plain TypeScript. No test runner exists for `ops-console` — verification is
`typecheck`/`lint` plus a real browser walkthrough against local Postgres, matching every
prior increment.

**Spec:** `docs/superpowers/specs/2026-08-12-billing-refresh-d4-design.md`

---

### Task 1: `billing-status.ts` — status maps + derived-state logic

**Files:**
- Create: `apps/ops-console/lib/billing-status.ts`

- [ ] **Step 1: Write the module**

```ts
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
```

- [ ] **Step 2: Typecheck (new file, no consumers yet — should pass standalone)**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ops-console/lib/billing-status.ts
git commit -m "D4: add billing-status module (status maps, overdue/attention/guard logic)"
```

---

### Task 2: `billing.ts` — billing-responsible sponsor lookup

**Files:**
- Create: `apps/ops-console/lib/billing.ts`

- [ ] **Step 1: Write the module**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@carebridge/domain";

// Same authority_grant -> family_sponsor -> user join lib/whatsapp.ts's private
// billingResponsibleSponsorUsers() already does (for phone, to send a WhatsApp message) —
// this selects full_name for display instead. Duplicated rather than shared: the two live in
// different modules selecting different columns, and this codebase already accepts this
// scale of duplication elsewhere (e.g. D1's EXPIRY_WARNING_DAYS constant) rather than forcing
// a premature shared abstraction across unrelated call sites.
export async function getBillingResponsibleSponsorName(
  supabase: SupabaseClient<Database>,
  clientId: string,
): Promise<string | null> {
  const { data: relationships } = await supabase
    .from("authority_grant")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("authority_type", "billing_responsible")
    .eq("status", "active");

  const sponsorIds = (relationships ?? []).map((r) => r.sponsor_id);
  if (sponsorIds.length === 0) return null;

  const { data: sponsors } = await supabase.from("family_sponsor").select("user_id").in("id", sponsorIds);
  const userIds = (sponsors ?? []).map((s) => s.user_id);
  if (userIds.length === 0) return null;

  const { data: users } = await supabase.from("user").select("full_name").in("id", userIds);
  return users?.[0]?.full_name ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ops-console/lib/billing.ts
git commit -m "D4: add getBillingResponsibleSponsorName helper"
```

---

### Task 3: `format.ts` — `formatCurrency`

**Files:**
- Modify: `apps/ops-console/lib/format.ts` (append to end of file)

- [ ] **Step 1: Append the new export**

```ts

// One Intl.NumberFormat instance per currency, cached — construction is the expensive part
// and a billing page can render dozens of amounts in the same currency in one request.
// currencyDisplay: "code" renders "GHS 1,200.00" rather than a symbol — avoids $ ambiguity
// across USD/GBP/EUR and matches this app's existing explicit-over-implicit formatting
// stance (same reasoning formatDateTime spells out "Accra time (GMT)" rather than relying on
// an implicit timezone).
const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();

export function formatCurrency(amount: number, currency: string): string {
  let formatter = CURRENCY_FORMATTERS.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "code" });
    CURRENCY_FORMATTERS.set(currency, formatter);
  }
  return formatter.format(amount);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ops-console/lib/format.ts
git commit -m "D4: add formatCurrency (cached Intl.NumberFormat per currency)"
```

---

### Task 4: `/billing` list — sponsor column, formatted currency, status badge, filters

**Files:**
- Modify: `apps/ops-console/app/billing/page.tsx` (full replace)

- [ ] **Step 1: Replace the whole file**

```tsx
import Link from "next/link";
import { buttonVariants, cn, DataTable, PageHeader, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatPlanName } from "@/lib/format";
import { getBillingResponsibleSponsorName } from "@/lib/billing";
import { getAttentionReasons, SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_VARIANT } from "@/lib/billing-status";
import { AppShell } from "@/components/app-shell";

type FilterValue = "attention" | "active" | "paused" | "cancelled";

const FILTERS: { value?: FilterValue; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "cancelled", label: "Cancelled" },
];

function buildHref(filter?: FilterValue): string {
  return filter ? `/billing?filter=${filter}` : "/billing";
}

function statusBadge(status: string) {
  return (
    <StatusBadge
      variant={SUBSCRIPTION_STATUS_VARIANT[status] ?? "neutral"}
      label={SUBSCRIPTION_STATUS_LABEL[status] ?? status}
    />
  );
}

interface SubscriptionRow {
  id: string;
  clientId: string;
  clientName: string;
  sponsorName: string | null;
  planCode: string;
  currency: string;
  amount: number;
  billingInterval: string;
  status: string;
  attentionReasons: string[];
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { filter } = await searchParams;
  const activeFilter: FilterValue | undefined =
    filter === "attention" || filter === "active" || filter === "paused" || filter === "cancelled"
      ? filter
      : undefined;

  const supabase = await createClient();

  const { data: subscriptions } = await supabase
    .from("subscription")
    .select("id, client_id, plan_code, currency, amount, billing_interval, status")
    .order("created_at", { ascending: false });

  const subscriptionIds = (subscriptions ?? []).map((s) => s.id);
  const clientIds = [...new Set((subscriptions ?? []).map((s) => s.client_id))];

  const [{ data: clients }, { data: invoices }, sponsorEntries] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("client").select("id, full_name").in("id", clientIds)
      : Promise.resolve({ data: [] }),
    subscriptionIds.length > 0
      ? supabase
          .from("invoice")
          .select("id, subscription_id, status, due_at, created_at")
          .in("subscription_id", subscriptionIds)
      : Promise.resolve({ data: [] }),
    Promise.all(clientIds.map(async (id) => [id, await getBillingResponsibleSponsorName(supabase, id)] as const)),
  ]);

  const clientNameById = new Map((clients ?? []).map((client) => [client.id, client.full_name]));
  const sponsorNameByClientId = new Map(sponsorEntries);

  const invoiceIds = (invoices ?? []).map((invoice) => invoice.id);
  const { data: payments } =
    invoiceIds.length > 0
      ? await supabase.from("payment").select("id, invoice_id, status, created_at").in("invoice_id", invoiceIds)
      : { data: [] };

  const paymentsByInvoiceId: Record<string, { status: string; createdAt: string }[]> = {};
  for (const payment of payments ?? []) {
    (paymentsByInvoiceId[payment.invoice_id] ??= []).push({ status: payment.status, createdAt: payment.created_at });
  }

  const invoicesBySubscriptionId: Record<
    string,
    { status: string; dueAt: string | null; payments: { status: string; createdAt: string }[] }[]
  > = {};
  for (const invoice of invoices ?? []) {
    (invoicesBySubscriptionId[invoice.subscription_id] ??= []).push({
      status: invoice.status,
      dueAt: invoice.due_at,
      payments: paymentsByInvoiceId[invoice.id] ?? [],
    });
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  const rows: SubscriptionRow[] = (subscriptions ?? []).map((subscription) => ({
    id: subscription.id,
    clientId: subscription.client_id,
    clientName: clientNameById.get(subscription.client_id) ?? subscription.client_id,
    sponsorName: sponsorNameByClientId.get(subscription.client_id) ?? null,
    planCode: subscription.plan_code,
    currency: subscription.currency,
    amount: subscription.amount,
    billingInterval: subscription.billing_interval,
    status: subscription.status,
    attentionReasons: getAttentionReasons({
      subscriptionStatus: subscription.status,
      invoices: invoicesBySubscriptionId[subscription.id] ?? [],
      todayIso,
    }),
  }));

  const filteredRows = !activeFilter
    ? rows
    : activeFilter === "attention"
      ? rows.filter((row) => row.attentionReasons.length > 0)
      : rows.filter((row) => row.status === activeFilter);

  return (
    <AppShell user={staffUser}>
      <PageHeader
        title="Billing"
        actions={
          <Link href="/billing/new" className={buttonVariants()}>
            New subscription
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Subscription filter">
        {FILTERS.map((option) => (
          <Link
            key={option.value ?? "all"}
            href={buildHref(option.value)}
            role="tab"
            aria-selected={activeFilter === option.value}
            className={cn(
              "rounded-md border border-border px-3 py-1.5 text-sm",
              activeFilter === option.value ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <DataTable<SubscriptionRow>
        rows={filteredRows}
        rowKey={(row) => row.id}
        emptyMessage={(subscriptions ?? []).length === 0 ? "No subscriptions yet." : "No subscriptions match this filter."}
        columns={[
          {
            key: "client",
            header: "Client",
            render: (row) => (
              <Link href={`/billing/${row.id}`} className="underline">
                {row.clientName}
              </Link>
            ),
          },
          { key: "sponsor", header: "Sponsor", render: (row) => row.sponsorName ?? "—" },
          { key: "plan", header: "Plan", render: (row) => formatPlanName(row.planCode) },
          { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount, row.currency) },
          { key: "interval", header: "Interval", render: (row) => row.billingInterval },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <div className="flex flex-wrap items-center gap-2">
                {statusBadge(row.status)}
                {row.attentionReasons.length > 0 ? (
                  <span className="text-xs text-critical">{row.attentionReasons.join("; ")}</span>
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </AppShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/billing/page.tsx
git commit -m "D4: billing list — sponsor column, formatted currency, status badge, filters"
```

---

### Task 5: `/billing/[id]` detail + `actions.ts` split

**Authored directly by the controller, not delegated to an implementer subagent** — see
Architecture above. Still gets the same spec-compliance + code-quality review pass as every
other task before being considered done. One task, two files, changed together (see
Architecture above for why they can't be split) — commit both in one commit.

**Files:**
- Modify: `apps/ops-console/app/billing/[id]/page.tsx` (full replace)
- Modify: `apps/ops-console/app/billing/[id]/actions.ts` (full replace)

- [ ] **Step 1: Replace `page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { Button, ConfirmSubmitButton, EntitySummaryCard, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatDateTime, formatPlanName } from "@/lib/format";
import { getBillingResponsibleSponsorName } from "@/lib/billing";
import {
  canSendPaymentRequest,
  getInvoiceDisplayStatus,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_VARIANT,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_VARIANT,
} from "@/lib/billing-status";
import { AppShell } from "@/components/app-shell";
import { createDraftInvoice, sendPaymentRequest } from "./actions";

interface InvoicePayment {
  id: string;
  invoice_id: string;
  processor: string;
  payment_link_url: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
}

function invoiceStatusBadge(status: string) {
  return (
    <StatusBadge
      variant={INVOICE_STATUS_VARIANT[status] ?? "neutral"}
      label={INVOICE_STATUS_LABEL[status] ?? status}
    />
  );
}

function paymentStatusBadge(status: string) {
  return (
    <StatusBadge
      variant={PAYMENT_STATUS_VARIANT[status] ?? "neutral"}
      label={PAYMENT_STATUS_LABEL[status] ?? status}
    />
  );
}

export default async function SubscriptionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; created?: string; draftCreated?: string; generated?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { id } = await params;
  const { error, created, draftCreated, generated } = await searchParams;

  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from("subscription")
    .select("id, client_id, plan_code, currency, amount, billing_interval, status")
    .eq("id", id)
    .maybeSingle();

  if (!subscription) {
    notFound();
  }

  const [{ data: client }, { data: invoices }, sponsorName] = await Promise.all([
    supabase.from("client").select("full_name").eq("id", subscription.client_id).maybeSingle(),
    supabase
      .from("invoice")
      .select("id, amount, currency, status, due_at, paid_at, created_at")
      .eq("subscription_id", subscription.id)
      .order("created_at", { ascending: false }),
    getBillingResponsibleSponsorName(supabase, subscription.client_id),
  ]);

  const invoiceIds = (invoices ?? []).map((invoice) => invoice.id);
  const { data: payments } =
    invoiceIds.length > 0
      ? await supabase
          .from("payment")
          .select("id, invoice_id, processor, payment_link_url, status, paid_at, created_at")
          .in("invoice_id", invoiceIds)
      : { data: [] as InvoicePayment[] };

  const paymentsByInvoiceId: Record<string, InvoicePayment[]> = {};
  for (const payment of payments ?? []) {
    (paymentsByInvoiceId[payment.invoice_id] ??= []).push(payment);
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <AppShell user={staffUser} toast={created ? { message: "Subscription created." } : undefined}>
      <EntitySummaryCard
        title={client?.full_name ?? "Unknown client"}
        meta={[
          { label: "Plan", value: formatPlanName(subscription.plan_code) },
          {
            label: "Amount",
            value: `${formatCurrency(subscription.amount, subscription.currency)} / ${subscription.billing_interval}`,
          },
          { label: "Status", value: subscription.status },
          { label: "Billing sponsor", value: sponsorName ?? "—" },
        ]}
      />

      {draftCreated ? <p className="mb-4 text-sm text-success">Draft invoice created.</p> : null}
      {generated ? <p className="mb-4 text-sm text-success">Payment request sent.</p> : null}
      {error ? <p className="mb-4 text-sm text-critical">{error}</p> : null}

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Invoices</h2>
          <form action={createDraftInvoice.bind(null, subscription.id)}>
            <Button type="submit" size="sm" variant="outline">
              Create draft invoice
            </Button>
          </form>
        </div>
        {(invoices ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(invoices ?? []).map((invoice) => {
              const invoicePayments = paymentsByInvoiceId[invoice.id] ?? [];
              const displayStatus = getInvoiceDisplayStatus({ status: invoice.status, dueAt: invoice.due_at }, todayIso);
              const canSend =
                (invoice.status === "draft" || invoice.status === "sent") &&
                canSendPaymentRequest(invoicePayments.map((p) => ({ status: p.status, createdAt: p.created_at })));

              return (
                <div key={invoice.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      {formatCurrency(invoice.amount, invoice.currency)}
                      {invoiceStatusBadge(displayStatus)}
                    </span>
                    <span className="text-muted-foreground">
                      {invoice.due_at ? `due ${formatDate(invoice.due_at)}` : ""}
                      {invoice.paid_at ? ` · paid ${formatDateTime(invoice.paid_at)}` : ""}
                    </span>
                  </div>
                  {invoicePayments.map((payment) => (
                    <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-2">
                        {payment.processor}
                        {paymentStatusBadge(payment.status)}
                      </span>
                      {payment.payment_link_url ? (
                        <a href={payment.payment_link_url} className="underline" target="_blank" rel="noreferrer">
                          payment link
                        </a>
                      ) : null}
                    </div>
                  ))}
                  {canSend ? (
                    <form action={sendPaymentRequest.bind(null, invoice.id)}>
                      <ConfirmSubmitButton
                        size="sm"
                        variant="outline"
                        confirmTitle="Send payment request"
                        confirmDescription={
                          <>
                            This requests a payment link from the processor and notifies the billing sponsor for{" "}
                            <strong>{client?.full_name ?? "this client"}</strong> —{" "}
                            {formatCurrency(invoice.amount, invoice.currency)}. This cannot be undone from here.
                          </>
                        }
                        confirmLabel="Send payment request"
                      >
                        Send payment request
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
```

- [ ] **Step 2: Replace `actions.ts`**

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 5: Commit both files together**

```bash
git add apps/ops-console/app/billing/[id]/page.tsx apps/ops-console/app/billing/[id]/actions.ts
git commit -m "D4: billing detail — Billing sponsor, ledger badges, split-action UI + actions"
```

---

### Task 6: Full typecheck/lint pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 3: Fix and re-run if either fails**

Fix any reported issue in the file it names, re-run both until clean.

---

### Task 7: Verify in the browser against real local Postgres

**Files:** none (verification only)

Ground truth from `supabase/seed.sql`'s 5 subscriptions / 2 invoices / 2 payments:

| Subscription | Client | Sponsor | Plan | Amount | Status | Attention |
|---|---|---|---|---|---|---|
| `f7…01` | Efua Asante | Yaw Asante | Standard Daily | GHS 1,200.00 | Active | none (1 `paid` invoice) |
| `f7…02` | Kwabena Ntim | Adjoa Ntim | Standard Daily | GHS 900.00 | Active | never invoiced |
| `f7…03` | Akua Serwaa | Kojo Serwaa | Diaspora Premium | USD 450.00 | Active | none at seed time (1 `sent` invoice, due +5d) |
| `f7…04` | Kofi Adjei | Nii Adjei | Standard Daily | GHS 1,100.00 | Active | never invoiced |
| `f7…05` | Abena Nyarko | Akosua Nyarko | Diaspora Premium | GBP 380.00 | Active | never invoiced |

`f7…01`'s invoice (`f8…01`) has a `paystack` `succeeded` payment — no Send-payment-request
button. `f7…03`'s invoice (`f8…02`) has a `stripe` `pending` payment — also no button (pending
blocks re-send). `f7…02`/`04`/`05` have zero invoices — "No invoices yet.", Create-draft
button present, no Send-payment-request button anywhere (nothing to send yet).

- [ ] **Step 1: Start the stack**

`supabase status` (start with `supabase start` + `supabase db reset` if not running). Start
the dev server: `pnpm --filter ops-console dev` (background). Set a local dev password on
`coordinator1@carebridge.dev` if not already set this session:

```bash
curl -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/a0000000-0000-0000-0000-000000000001" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"password":"carebridge-dev-2026"}'
```

- [ ] **Step 2: Confirm `/billing` against the ground-truth grid**

Log in as `coordinator1@carebridge.dev` / `carebridge-dev-2026`, go to `/billing`. Confirm all
5 rows match the grid exactly (client, sponsor, plan, formatted amount, Active badge). Confirm
`f7…02`/`04`/`05` each show "never invoiced" next to their status badge; `f7…01`/`03` show
none.

- [ ] **Step 3: Confirm filters**

Click "Needs attention" — confirm exactly `f7…02`/`04`/`05` show. Click "Active" — confirm all
5 show (every seeded subscription is active). Click "Paused"/"Cancelled" — confirm both show
zero rows (no seeded subscription in either state). Click "All" to return.

- [ ] **Step 4: Confirm `/billing/f7…01` (paid invoice, no button)**

Open `f7…01`. Confirm "Billing sponsor: Yaw Asante" in the summary card. Confirm the one
invoice shows `GHS 1,200.00`, a "Paid" delivery badge, a "Succeeded" processor badge under
`paystack`, and **no** "Send payment request" button.

- [ ] **Step 5: Confirm `/billing/f7…03` (sent + pending, no button; then overdue)**

Open `f7…03`. Confirm "Billing sponsor: Kojo Serwaa". Confirm the invoice shows `USD 450.00`,
a "Sent" delivery badge (not yet overdue), a "Pending" processor badge under `stripe` with a
"payment link" link, and no "Send payment request" button. Then temporarily push its due date
into the past:

```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c \
  "update invoice set due_at = current_date - 1 where id = 'f8000000-0000-0000-0000-000000000002';"
```

Reload. Confirm the delivery badge now reads "Overdue" (critical-colored), and that `/billing`
now shows `f7…03` under "Needs attention" with reason "invoice overdue".

- [ ] **Step 6: Create a draft invoice, then send it**

Open `f7…02` (Kwabena Ntim, zero invoices). Confirm "No invoices yet." and a visible "Create
draft invoice" button. Click it. Confirm redirect to `?draftCreated=1`, a new invoice card
appears with a "Draft" delivery badge, `GHS 900.00`, no payment rows, and a "Send payment
request" button. Click it, confirm the dialog, submit. Confirm redirect to `?generated=1`, the
invoice's delivery badge is now "Sent", a payment row appears (processor + "Pending" badge,
or a real payment link if Paystack/Stripe env keys happen to be set locally — they won't be by
default, which is fine, matches the existing linkless-pending fallback), and the "Send payment
request" button is now gone from that card.

- [ ] **Step 7: Confirm server-side duplicate protection (bypass the UI)**

With that same now-`sent` invoice from Step 6, open browser devtools and submit a POST
directly to `sendPaymentRequest` for that invoice id (or re-add/un-hide the button via
devtools and click it) to attempt sending a second payment request. Confirm the response
redirects with `?error=A%20payment%20request%20has%20already%20been%20sent...` and that
**no second `payment` row** was created (`select count(*) from payment where invoice_id =
'<that invoice id>'` via `docker exec -i supabase_db_carebridge psql -U postgres -d postgres`
returns `1`) — the actual proof this is server-enforced, not just button-hidden.

- [ ] **Step 8: Confirm the failed-payment retry path (temporary data edit)**

```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c \
  "update payment set status = 'failed' where invoice_id = '<the Step 6 invoice's id>';"
```

Reload `/billing/f7…02`. Confirm the "Send payment request" button reappears on that `sent`
invoice (its latest — and only — payment is now `failed`). Click it, submit, confirm a
**second** `payment` row lands for that invoice (`select count(*) ... ` now returns `2`) and
the first (failed) row is untouched, still present as history.

- [ ] **Step 9: Clean up**

```bash
supabase db reset
```

Stop the dev server. `supabase stop`.

No code changes in this task. If any step's actual result doesn't match what's described, do
not patch ad hoc — report exactly what happened so the relevant task above can be fixed.

---

### Task 8: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off Increment D4**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist):

```
  - [ ] Increment D4 (worker-tier, no schema): billing list/detail refresh — human plan names, consistent currency formatting, status badges, invoice ledger, "needs attention" view, separate "create draft invoice" from "send payment request" actions
```

Replace with a checked line summarizing what was actually built and verified, in this file's
established style. Record at minimum: `formatCurrency` (cached `Intl.NumberFormat` per
currency); a Sponsor column/Billing-sponsor field via a new
`getBillingResponsibleSponsorName` helper; subscription/invoice/payment status badges;
"needs attention" (never-invoiced / overdue / payment-failed) computed read-time, never
written, since nothing in this schema ever sets `invoice.status = 'overdue'` or
`payment.status = 'failed'`; the `generateInvoice` action split into `createDraftInvoice`
(record-only) and a duplicate-protected, server-re-checked `sendPaymentRequest`; Task 5 (the
action split) was authored directly rather than delegated, per CLAUDE.md's supervisor-tier
financial-logic rule. Note this closes the epic's D-series — check whether this also closes
the whole "Ops Console UX Refresh" epic against the review's "Definition of professionally
refreshed" checklist (re-read that section of the review doc before marking the epic itself
done; D4 closing does not automatically mean the epic's own exit condition is met without
checking).

- [ ] **Step 2: Update the "Last updated" summary line**

Update the top summary line to reflect D4 is done. If this closes the whole epic per Step 1's
check, say so and name whatever's next in Phase 1's checklist; if not, note what's still open.
Confirm against the roadmap's own checklist rather than trusting this plan's memory of it.

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment D4"
```

(Adjust the commit message if Step 1's check also closes the epic — confirm against the
roadmap's own checklist before writing it, the epic's ordering is the source of truth, not
this plan's guess.)
