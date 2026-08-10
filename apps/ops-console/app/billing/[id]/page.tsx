import { notFound } from "next/navigation";
import { Button } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateInvoice } from "./actions";

export default async function SubscriptionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; created?: string; generated?: string }>;
}) {
  await requireStaffUser();
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
    <main className="flex min-h-screen flex-col items-center gap-8 p-24">
      <h1 className="text-2xl font-semibold">{client?.full_name ?? "Unknown client"}</h1>
      <p className="text-muted-foreground">
        {subscription.plan_code} — {subscription.currency} {subscription.amount} / {subscription.billing_interval} —{" "}
        {subscription.status}
      </p>

      {created ? <p className="text-sm text-emerald-700">Subscription created.</p> : null}
      {generated ? <p className="text-sm text-emerald-700">Invoice generated.</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Invoices</h2>
          <form action={generateInvoice.bind(null, subscription.id)}>
            <Button type="submit" size="sm">
              Generate invoice
            </Button>
          </form>
        </div>
        {(invoices ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(invoices ?? []).map((invoice) => (
              <div key={invoice.id} className="flex flex-col gap-1 rounded-md border border-border p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {invoice.currency} {invoice.amount} — {invoice.status}
                  </span>
                  <span className="text-muted-foreground">
                    {invoice.due_at ? `due ${invoice.due_at}` : ""}
                    {invoice.paid_at ? ` · paid ${new Date(invoice.paid_at).toLocaleString()}` : ""}
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
    </main>
  );
}
