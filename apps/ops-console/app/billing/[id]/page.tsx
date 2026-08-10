import { notFound } from "next/navigation";
import { ConfirmSubmitButton, EntitySummaryCard } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPlanName } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { generateInvoice } from "./actions";

export default async function SubscriptionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; created?: string; generated?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { id } = await params;
  const { error, created, generated } = await searchParams;

  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from("subscription")
    .select("id, client_id, plan_code, currency, amount, billing_interval, status")
    .eq("id", id)
    .maybeSingle();

  if (!subscription) {
    notFound();
  }

  const [{ data: client }, { data: invoices }] = await Promise.all([
    supabase.from("client").select("full_name").eq("id", subscription.client_id).maybeSingle(),
    supabase
      .from("invoice")
      .select("id, amount, currency, status, due_at, paid_at, created_at")
      .eq("subscription_id", subscription.id)
      .order("created_at", { ascending: false }),
  ]);

  const invoiceIds = (invoices ?? []).map((invoice) => invoice.id);
  const { data: payments } =
    invoiceIds.length > 0
      ? await supabase
          .from("payment")
          .select("id, invoice_id, processor, payment_link_url, status, paid_at")
          .in("invoice_id", invoiceIds)
      : { data: [] };

  const paymentsByInvoiceId = new Map<string, typeof payments>();
  for (const payment of payments ?? []) {
    const existing = paymentsByInvoiceId.get(payment.invoice_id) ?? [];
    existing.push(payment);
    paymentsByInvoiceId.set(payment.invoice_id, existing);
  }

  return (
    <AppShell
      user={staffUser}
      toast={created ? { message: "Subscription created." } : undefined}
    >
      <EntitySummaryCard
        title={client?.full_name ?? "Unknown client"}
        meta={[
          { label: "Plan", value: formatPlanName(subscription.plan_code) },
          { label: "Amount", value: `${subscription.currency} ${subscription.amount} / ${subscription.billing_interval}` },
          { label: "Status", value: subscription.status },
        ]}
      />

      {generated ? <p className="mb-4 text-sm text-success">Invoice generated.</p> : null}
      {error ? <p className="mb-4 text-sm text-critical">{error}</p> : null}

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Invoices</h2>
          <form action={generateInvoice.bind(null, subscription.id)}>
            <ConfirmSubmitButton
              size="sm"
              confirmTitle="Generate invoice"
              confirmDescription={
                <>
                  This creates a live invoice for <strong>{client?.full_name ?? "this client"}</strong> —{" "}
                  {subscription.currency} {subscription.amount} — and requests a payment link from the
                  processor. This cannot be undone from here.
                </>
              }
              confirmLabel="Generate invoice"
            >
              Generate invoice
            </ConfirmSubmitButton>
          </form>
        </div>
        {(invoices ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(invoices ?? []).map((invoice) => (
              <div key={invoice.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {invoice.currency} {invoice.amount} — {invoice.status}
                  </span>
                  <span className="text-muted-foreground">
                    {invoice.due_at ? `due ${formatDate(invoice.due_at)}` : ""}
                    {invoice.paid_at ? ` · paid ${formatDateTime(invoice.paid_at)}` : ""}
                  </span>
                </div>
                {(paymentsByInvoiceId.get(invoice.id) ?? []).map((payment) => (
                  <div key={payment!.id} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {payment!.processor} — {payment!.status}
                    </span>
                    {payment!.payment_link_url ? (
                      <a href={payment!.payment_link_url} className="underline" target="_blank" rel="noreferrer">
                        payment link
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
