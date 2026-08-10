import Link from "next/link";
import { buttonVariants } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function VisitsToLogPage({
  searchParams,
}: {
  searchParams: Promise<{ logged?: string }>;
}) {
  await requireStaffUser();
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
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Log a visit</h1>
      {logged ? <p className="text-sm text-emerald-700">Visit outcome logged.</p> : null}

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-2">Client</th>
            <th className="py-2">Provider</th>
            <th className="py-2">Scheduled</th>
            <th className="py-2">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {(visits ?? []).map((visit) => (
            <tr key={visit.id} className="border-t border-border">
              <td className="py-2">{clientNameById.get(visit.client_id) ?? visit.client_id}</td>
              <td className="py-2">{providerNameById.get(visit.provider_id) ?? visit.provider_id}</td>
              <td className="py-2">{new Date(visit.scheduled_start).toLocaleString()}</td>
              <td className="py-2">{visit.status}</td>
              <td className="py-2">
                <Link href={`/visits/${visit.id}/log`} className={buttonVariants({ size: "sm" })}>
                  Log outcome
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(visits ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No visits waiting to be logged.</p>
      ) : null}
    </main>
  );
}
