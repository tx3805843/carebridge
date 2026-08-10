import Link from "next/link";
import { buttonVariants } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function BillingPage() {
  await requireStaffUser();

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
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <Link href="/billing/new" className={buttonVariants()}>
        New subscription
      </Link>

      <table className="w-full max-w-3xl text-left text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-2">Client</th>
            <th className="py-2">Plan</th>
            <th className="py-2">Amount</th>
            <th className="py-2">Interval</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {(subscriptions ?? []).map((subscription) => (
            <tr key={subscription.id} className="border-t border-border">
              <td className="py-2">
                <Link href={`/billing/${subscription.id}`} className="underline">
                  {clientNameById.get(subscription.client_id) ?? subscription.client_id}
                </Link>
              </td>
              <td className="py-2">{subscription.plan_code}</td>
              <td className="py-2">
                {subscription.currency} {subscription.amount}
              </td>
              <td className="py-2">{subscription.billing_interval}</td>
              <td className="py-2">{subscription.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
