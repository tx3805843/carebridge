import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { acknowledgeEscalation, resolveEscalation } from "./actions";

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; acknowledged?: string; resolved?: string }>;
}) {
  await requireStaffUser();
  const { error, acknowledged, resolved } = await searchParams;

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [{ data: pastDueVisits }, { data: openEscalations }] = await Promise.all([
    supabase
      .from("visit")
      .select("id, client_id, provider_id, scheduled_start, scheduled_end, status")
      .lt("scheduled_end", nowIso)
      .order("scheduled_end", { ascending: false }),
    supabase
      .from("escalation")
      .select(
        "id, client_id, visit_id, severity, reason, status, acknowledged_at, resolved_at, resolution_notes, created_at",
      )
      .neq("status", "resolved")
      .order("created_at", { ascending: false }),
  ]);

  const lateVisits = (pastDueVisits ?? []).filter(
    (visit) => visit.status !== "completed" && visit.status !== "cancelled",
  );
  const sortedEscalations = [...(openEscalations ?? [])].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
  );

  const clientIds = [
    ...new Set([...lateVisits.map((visit) => visit.client_id), ...sortedEscalations.map((e) => e.client_id)]),
  ];
  const providerIds = [...new Set(lateVisits.map((visit) => visit.provider_id))];

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
    <main className="flex min-h-screen flex-col items-center gap-10 p-24">
      <h1 className="text-2xl font-semibold">Exception queue</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {acknowledged ? <p className="text-sm text-emerald-700">Escalation acknowledged.</p> : null}
      {resolved ? <p className="text-sm text-emerald-700">Escalation resolved.</p> : null}

      <section className="flex w-full max-w-3xl flex-col gap-3">
        <h2 className="text-lg font-medium">Late & missed visits</h2>
        {lateVisits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No overdue visits.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-2">Client</th>
                <th className="py-2">Provider</th>
                <th className="py-2">Scheduled end</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {lateVisits.map((visit) => (
                <tr key={visit.id} className="border-t border-border">
                  <td className="py-2">{clientNameById.get(visit.client_id) ?? visit.client_id}</td>
                  <td className="py-2">{providerNameById.get(visit.provider_id) ?? visit.provider_id}</td>
                  <td className="py-2">{new Date(visit.scheduled_end).toLocaleString()}</td>
                  <td className="py-2">{visit.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex w-full max-w-3xl flex-col gap-3">
        <h2 className="text-lg font-medium">Open escalations</h2>
        {sortedEscalations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open escalations.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {sortedEscalations.map((escalation) => (
              <div key={escalation.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {clientNameById.get(escalation.client_id) ?? escalation.client_id} —{" "}
                    <span className="uppercase">{escalation.severity}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">{escalation.status}</span>
                </div>
                <p className="text-sm">{escalation.reason}</p>
                <p className="text-xs text-muted-foreground">
                  Opened {new Date(escalation.created_at).toLocaleString()}
                  {escalation.acknowledged_at
                    ? ` — acknowledged ${new Date(escalation.acknowledged_at).toLocaleString()}`
                    : ""}
                </p>
                <div className="flex gap-2">
                  {escalation.status === "open" ? (
                    <form action={acknowledgeEscalation.bind(null, escalation.id)}>
                      <button
                        type="submit"
                        className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted"
                      >
                        Acknowledge
                      </button>
                    </form>
                  ) : null}
                  <form
                    action={resolveEscalation.bind(null, escalation.id)}
                    className="flex flex-1 gap-2"
                  >
                    <input
                      name="resolutionNotes"
                      placeholder="Resolution notes (optional)"
                      className="flex-1 rounded-md border border-border px-3 py-1 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90"
                    >
                      Resolve
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
