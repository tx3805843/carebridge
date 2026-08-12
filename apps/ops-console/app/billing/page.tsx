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
