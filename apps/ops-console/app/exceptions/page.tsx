import Link from "next/link";
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
  const warningCutoffIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

  // Credential expiry — the "flag within 30 days" half of CLAUDE.md's credential-expiry
  // guardrail (the "auto-suspend on lapse" half is verified_profile.nmc_licensed, computed by
  // the credential-expiry-cron Edge Function; this just surfaces both signals for staff).
  const [{ data: expiringCredentials }, { data: suspendedProfiles }] = await Promise.all([
    supabase
      .from("credential")
      .select("id, provider_id, credential_type_id, expiry_date")
      .not("expiry_date", "is", null)
      .lte("expiry_date", warningCutoffIso)
      .neq("status", "expired")
      .order("expiry_date", { ascending: true }),
    supabase.from("verified_profile").select("provider_id").eq("nmc_licensed", false),
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
  const providerIds = [
    ...new Set([
      ...lateVisits.map((visit) => visit.provider_id),
      ...(expiringCredentials ?? []).map((c) => c.provider_id),
      ...(suspendedProfiles ?? []).map((p) => p.provider_id),
    ]),
  ];

  const [{ data: clients }, { data: providers }, { data: credentialTypes }, { data: nurseRole }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("client").select("id, full_name").in("id", clientIds)
      : Promise.resolve({ data: [] }),
    providerIds.length > 0
      ? supabase.from("provider").select("id, user_id").in("id", providerIds)
      : Promise.resolve({ data: [] }),
    supabase.from("credential_type").select("id, label"),
    supabase.from("role").select("id").eq("slug", "nurse").single(),
  ]);

  const providerUserIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: providerUsers } =
    providerUserIds.length > 0
      ? await supabase.from("user").select("id, full_name, role_id").in("id", providerUserIds)
      : { data: [] };

  const providerUserById = new Map((providerUsers ?? []).map((user) => [user.id, user]));
  const clientNameById = new Map((clients ?? []).map((client) => [client.id, client.full_name]));
  const providerNameById = new Map(
    (providers ?? []).map((provider) => [provider.id, providerUserById.get(provider.user_id)?.full_name ?? "Unnamed provider"]),
  );
  const credentialTypeLabelById = new Map((credentialTypes ?? []).map((type) => [type.id, type.label]));

  const sortedExpiringCredentials = [...(expiringCredentials ?? [])].sort((a, b) =>
    (a.expiry_date ?? "").localeCompare(b.expiry_date ?? ""),
  );

  // Only nurses have an NMC PIN/AIN — verified_profile.nmc_licensed is trivially false for
  // every caregiver too (they never had it), so "suspended" here means "a nurse whose
  // scheduling eligibility actually lapsed," not "everyone without the flag set."
  const suspendedNurseProviderIds = new Set(
    (suspendedProfiles ?? [])
      .filter((profile) => {
        const provider = (providers ?? []).find((p) => p.id === profile.provider_id);
        const user = provider ? providerUserById.get(provider.user_id) : undefined;
        return user?.role_id === nurseRole?.id;
      })
      .map((profile) => profile.provider_id),
  );
  const suspendedProviders = (providers ?? []).filter((provider) => suspendedNurseProviderIds.has(provider.id));

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

      <section className="flex w-full max-w-3xl flex-col gap-3">
        <h2 className="text-lg font-medium">Credential expiry</h2>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Expiring within 30 days</h3>
          {sortedExpiringCredentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing expiring soon.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="py-2">Provider</th>
                  <th className="py-2">Credential</th>
                  <th className="py-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {sortedExpiringCredentials.map((credential) => (
                  <tr key={credential.id} className="border-t border-border">
                    <td className="py-2">{providerNameById.get(credential.provider_id) ?? credential.provider_id}</td>
                    <td className="py-2">{credentialTypeLabelById.get(credential.credential_type_id) ?? "—"}</td>
                    <td className="py-2">{credential.expiry_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Suspended from scheduling (lapsed NMC PIN/AIN)
          </h3>
          {suspendedProviders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No nurses currently suspended.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {suspendedProviders.map((provider) => (
                <li key={provider.id}>
                  <Link href={`/providers/${provider.id}`} className="underline">
                    {providerNameById.get(provider.id) ?? provider.id}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
