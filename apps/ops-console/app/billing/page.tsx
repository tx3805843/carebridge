import Link from "next/link";
import { buttonVariants, DataTable, PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPlanName } from "@/lib/format";
import { AppShell } from "@/components/app-shell";

interface SubscriptionRow {
  id: string;
  client_id: string;
  plan_code: string;
  currency: string;
  amount: number;
  billing_interval: string;
  status: string;
}

export default async function BillingPage() {
  const staffUser = await requireStaffUser();

  const supabase = await createClient();

  const { data: subscriptions } = await supabase
    .from("subscription")
    .select("id, client_id, plan_code, currency, amount, billing_interval, status")
    .order("created_at", { ascending: false });

  const clientIds = [...new Set((subscriptions ?? []).map((s) => s.client_id))];
  const { data: clients } =
    clientIds.length > 0 ? await supabase.from("client").select("id, full_name").in("id", clientIds) : { data: [] };
  const clientNameById = new Map((clients ?? []).map((client) => [client.id, client.full_name]));

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
      <DataTable<SubscriptionRow>
        rows={subscriptions ?? []}
        rowKey={(row) => row.id}
        emptyMessage="No subscriptions yet."
        columns={[
          {
            key: "client",
            header: "Client",
            render: (row) => (
              <Link href={`/billing/${row.id}`} className="underline">
                {clientNameById.get(row.client_id) ?? row.client_id}
              </Link>
            ),
          },
          { key: "plan", header: "Plan", render: (row) => formatPlanName(row.plan_code) },
          { key: "amount", header: "Amount", render: (row) => `${row.currency} ${row.amount}` },
          { key: "interval", header: "Interval", render: (row) => row.billing_interval },
          { key: "status", header: "Status", render: (row) => row.status },
        ]}
      />
    </AppShell>
  );
}
