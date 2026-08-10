import Link from "next/link";
import { buttonVariants, DataTable, PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { AppShell } from "@/components/app-shell";

interface VisitRow {
  id: string;
  client_id: string;
  provider_id: string;
  scheduled_start: string;
  status: string;
}

export default async function VisitsToLogPage({
  searchParams,
}: {
  searchParams: Promise<{ logged?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { logged } = await searchParams;

  const supabase = await createClient();

  const { data: visits } = await supabase
    .from("visit")
    .select("id, client_id, provider_id, scheduled_start, scheduled_end, status")
    .in("status", ["scheduled", "en_route", "in_progress"])
    .order("scheduled_start");

  const clientIds = [...new Set((visits ?? []).map((visit) => visit.client_id))];
  const providerIds = [...new Set((visits ?? []).map((visit) => visit.provider_id))];

  const [{ data: clients }, { data: providers }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("client").select("id, full_name").in("id", clientIds)
      : Promise.resolve({ data: [] }),
    providerIds.length > 0
      ? supabase.from("provider").select("id, user_id").in("id", providerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const providerUserIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: providerUsers } =
    providerUserIds.length > 0
      ? await supabase.from("user").select("id, full_name").in("id", providerUserIds)
      : { data: [] };

  const providerNameByUserId = new Map((providerUsers ?? []).map((user) => [user.id, user.full_name]));
  const clientNameById = new Map((clients ?? []).map((client) => [client.id, client.full_name]));
  const providerNameById = new Map(
    (providers ?? []).map((provider) => [provider.id, providerNameByUserId.get(provider.user_id) ?? "Unnamed provider"]),
  );

  return (
    <AppShell user={staffUser} toast={logged ? { message: "Visit outcome logged." } : undefined}>
      <PageHeader title="Log a visit" />
      <div className="w-full max-w-2xl">
        <DataTable<VisitRow>
          rows={visits ?? []}
          rowKey={(row) => row.id}
          emptyMessage="No visits waiting to be logged."
          columns={[
            { key: "client", header: "Client", render: (row) => clientNameById.get(row.client_id) ?? row.client_id },
            { key: "provider", header: "Provider", render: (row) => providerNameById.get(row.provider_id) ?? row.provider_id },
            { key: "scheduled", header: "Scheduled", render: (row) => formatDateTime(row.scheduled_start) },
            { key: "status", header: "Status", render: (row) => row.status },
            {
              key: "action",
              header: "",
              render: (row) => (
                <Link href={`/visits/${row.id}/log`} className={buttonVariants({ size: "sm" })}>
                  Log outcome
                </Link>
              ),
            },
          ]}
        />
      </div>
    </AppShell>
  );
}
