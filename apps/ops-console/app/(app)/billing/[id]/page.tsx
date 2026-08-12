import { notFound } from "next/navigation";
import { Button, ConfirmSubmitButton, EntitySummaryCard, StatusBadge } from "@carebridge/ui";
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
import { ToastEffect } from "@/components/app-shell";
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
    <>
      <ToastEffect toast={created ? { message: "Subscription created." } : undefined} />
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
    </>
  );
}
