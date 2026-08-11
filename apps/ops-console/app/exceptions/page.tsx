import Link from "next/link";
import { Button, ConfirmSubmitButton, DataTable, EntitySummaryCard, PageHeader, StatusBadge, cn } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatRelativeAge } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { acknowledgeEscalation, assignEscalation, resolveEscalation } from "./actions";
import {
  CRITICAL_RESOLVER_ROLE_SLUGS,
  OUTCOME_CATEGORIES,
  OUTCOME_CATEGORY_LABEL,
  SEVERITY_BADGE_VARIANT,
  SEVERITY_LABEL,
  SEVERITY_RANK,
} from "./constants";
import { buildEscalationTimeline, formatResponseTarget } from "./utils";

const STATUS_BADGE_VARIANT: Record<string, "warning" | "information" | "success"> = {
  open: "warning",
  acknowledged: "information",
  resolved: "success",
};

const STATUS_LABEL: Record<string, string> = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved" };

const ESCALATION_FIELDS =
  "id, client_id, visit_id, severity, reason, status, assigned_to, outcome_category, acknowledged_at, resolved_at, resolved_by, resolution_notes, created_at";

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    acknowledged?: string;
    assigned?: string;
    resolved?: string;
    view?: string;
    case?: string;
  }>;
}) {
  const staffUser = await requireStaffUser();
  const { error, acknowledged, assigned, resolved, view: viewParam, case: caseParam } = await searchParams;
  const view = viewParam === "resolved" ? "resolved" : "open";

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const warningCutoffIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [{ data: pastDueVisits }, { data: escalationRows }] = await Promise.all([
    supabase
      .from("visit")
      .select("id, client_id, provider_id, scheduled_start, scheduled_end, status")
      .lt("scheduled_end", nowIso)
      .order("scheduled_end", { ascending: false }),
    view === "resolved"
      ? supabase.from("escalation").select(ESCALATION_FIELDS).eq("status", "resolved").order("resolved_at", { ascending: false })
      : supabase.from("escalation").select(ESCALATION_FIELDS).neq("status", "resolved").order("created_at", { ascending: false }),
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
  const sortedEscalations = [...(escalationRows ?? [])].sort((a, b) =>
    view === "resolved"
      ? (b.resolved_at ?? "").localeCompare(a.resolved_at ?? "")
      : (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) || a.created_at.localeCompare(b.created_at),
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

  const [{ data: clients }, { data: providers }, { data: credentialTypes }, { data: nurseRole }, { data: staffRoles }] =
    await Promise.all([
      clientIds.length > 0
        ? supabase.from("client").select("id, full_name").in("id", clientIds)
        : Promise.resolve({ data: [] }),
      providerIds.length > 0
        ? supabase.from("provider").select("id, user_id").in("id", providerIds)
        : Promise.resolve({ data: [] }),
      supabase.from("credential_type").select("id, label"),
      supabase.from("role").select("id").eq("slug", "nurse").single(),
      supabase.from("role").select("id, slug, label").in("slug", ["coordinator", "clinical_director", "admin"]),
    ]);

  const providerUserIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: providerUsers } =
    providerUserIds.length > 0
      ? await supabase.from("user").select("id, full_name, role_id").in("id", providerUserIds)
      : { data: [] };

  const staffRoleIds = (staffRoles ?? []).map((role) => role.id);
  const staffRoleLabelById = new Map((staffRoles ?? []).map((role) => [role.id, role.label]));
  const { data: staffMembers } =
    staffRoleIds.length > 0
      ? await supabase.from("user").select("id, full_name, role_id").in("role_id", staffRoleIds)
      : { data: [] };

  const providerUserById = new Map((providerUsers ?? []).map((user) => [user.id, user]));
  const clientNameById = new Map((clients ?? []).map((client) => [client.id, client.full_name]));
  const providerNameById = new Map(
    (providers ?? []).map((provider) => [provider.id, providerUserById.get(provider.user_id)?.full_name ?? "Unnamed provider"]),
  );
  const credentialTypeLabelById = new Map((credentialTypes ?? []).map((type) => [type.id, type.label]));
  const staffNameById = new Map((staffMembers ?? []).map((member) => [member.id, member.full_name]));
  const staffOptions = (staffMembers ?? []).map((member) => ({
    id: member.id,
    label: `${member.full_name} — ${staffRoleLabelById.get(member.role_id) ?? "Staff"}`,
  }));

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

  const selectedEscalation = sortedEscalations.find((e) => e.id === caseParam) ?? sortedEscalations[0] ?? null;

  const { data: auditRows } = selectedEscalation
    ? await supabase
        .from("audit_log")
        .select("operation, actor_user_id, old_data, new_data, occurred_at")
        .eq("table_name", "escalation")
        .eq("record_id", selectedEscalation.id)
        .order("occurred_at", { ascending: true })
    : { data: [] };

  const timeline = selectedEscalation
    ? buildEscalationTimeline(auditRows ?? [], staffNameById, OUTCOME_CATEGORY_LABEL)
    : [];

  const caseHref = (id: string) => `/exceptions?view=${view}&case=${id}`;
  const isCritical = selectedEscalation?.severity === "critical";
  const canResolveCritical = CRITICAL_RESOLVER_ROLE_SLUGS.includes(staffUser.roleSlug);

  return (
    <AppShell
      user={staffUser}
      toast={
        acknowledged
          ? { message: "Escalation acknowledged." }
          : assigned
            ? { message: "Case assigned." }
            : undefined
      }
    >
      <PageHeader
        title="Exception queue"
        description="Safety and service exceptions ordered by severity and response target."
      />
      {error ? <p role="alert" className="mb-4 text-sm text-critical">{error}</p> : null}
      {resolved ? <p role="status" className="mb-4 text-sm text-success">Case resolved.</p> : null}

      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
            <div className="flex gap-2" role="tablist" aria-label="Escalation view">
              <Link
                href="/exceptions?view=open"
                role="tab"
                aria-selected={view === "open"}
                className={cn(
                  "rounded-md border border-border px-3 py-1.5 text-sm",
                  view === "open" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                Open ({view === "open" ? sortedEscalations.length : "…"})
              </Link>
              <Link
                href="/exceptions?view=resolved"
                role="tab"
                aria-selected={view === "resolved"}
                className={cn(
                  "rounded-md border border-border px-3 py-1.5 text-sm",
                  view === "resolved" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                Resolved
              </Link>
            </div>

            {sortedEscalations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {view === "resolved" ? "No resolved cases yet." : "No open escalations."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedEscalations.map((escalation) => {
                  const responseTarget = formatResponseTarget(escalation.created_at, escalation.severity, escalation.status);
                  const isSelected = selectedEscalation?.id === escalation.id;
                  return (
                    <li key={escalation.id}>
                      <Link
                        href={caseHref(escalation.id)}
                        aria-current={isSelected ? "true" : undefined}
                        className={cn(
                          "flex flex-col gap-1.5 rounded-md border p-3 text-sm transition-colors",
                          escalation.severity === "critical"
                            ? "border-critical/30 bg-critical/5"
                            : "border-border bg-surface",
                          isSelected ? "ring-2 ring-primary" : "hover:bg-muted",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <StatusBadge variant={SEVERITY_BADGE_VARIANT[escalation.severity]} label={SEVERITY_LABEL[escalation.severity] ?? escalation.severity} />
                          <StatusBadge variant={STATUS_BADGE_VARIANT[escalation.status]} label={STATUS_LABEL[escalation.status] ?? escalation.status} />
                        </div>
                        <span className="font-medium">{clientNameById.get(escalation.client_id) ?? escalation.client_id}</span>
                        <span className="line-clamp-2 text-muted-foreground">{escalation.reason}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeAge(escalation.created_at)}
                          {escalation.assigned_to ? ` · Owner: ${staffNameById.get(escalation.assigned_to) ?? "Unassigned"}` : " · Unassigned"}
                          {responseTarget ? ` · ${responseTarget}` : ""}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {!selectedEscalation ? (
              <p className="text-sm text-muted-foreground">Select a case to view details.</p>
            ) : (
              <div key={selectedEscalation.id} className="flex flex-col gap-6">
                <EntitySummaryCard
                  title={clientNameById.get(selectedEscalation.client_id) ?? selectedEscalation.client_id}
                  subtitle={`Case ${selectedEscalation.id.slice(0, 8)} · opened ${formatDateTime(selectedEscalation.created_at)}`}
                  meta={[
                    { label: "Severity", value: <StatusBadge variant={SEVERITY_BADGE_VARIANT[selectedEscalation.severity]} label={SEVERITY_LABEL[selectedEscalation.severity] ?? selectedEscalation.severity} /> },
                    { label: "Status", value: <StatusBadge variant={STATUS_BADGE_VARIANT[selectedEscalation.status]} label={STATUS_LABEL[selectedEscalation.status] ?? selectedEscalation.status} /> },
                    { label: "Owner", value: selectedEscalation.assigned_to ? staffNameById.get(selectedEscalation.assigned_to) ?? "Unknown" : "Unassigned" },
                    ...(selectedEscalation.visit_id
                      ? [{ label: "Related visit", value: <Link href={`/visits/${selectedEscalation.visit_id}/log`} className="underline">Open visit record</Link> }]
                      : []),
                  ]}
                  actions={
                    selectedEscalation.status !== "resolved" ? (
                      <>
                        <form action={assignEscalation.bind(null, selectedEscalation.id)} className="flex items-center gap-2">
                          <label htmlFor="assigneeId" className="sr-only">
                            Assign case to
                          </label>
                          <select
                            id="assigneeId"
                            name="assigneeId"
                            defaultValue={selectedEscalation.assigned_to ?? ""}
                            className="rounded-md border border-border px-2 py-1.5 text-sm"
                          >
                            <option value="" disabled>
                              Assign to…
                            </option>
                            {staffOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" variant="outline" size="sm">
                            Assign
                          </Button>
                        </form>
                        {selectedEscalation.status === "open" ? (
                          <form action={acknowledgeEscalation.bind(null, selectedEscalation.id)}>
                            <Button type="submit" size="sm">
                              Acknowledge
                            </Button>
                          </form>
                        ) : null}
                      </>
                    ) : undefined
                  }
                />

                <div
                  className={cn(
                    "rounded-md border p-4 text-sm",
                    isCritical ? "border-critical/30 bg-critical/5" : "border-border bg-surface",
                  )}
                >
                  <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Original report
                  </h2>
                  <p>{selectedEscalation.reason}</p>
                </div>

                <section>
                  <h2 className="mb-2 text-sm font-medium">Activity and evidence</h2>
                  {timeline.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                  ) : (
                    <ol className="flex flex-col gap-3 border-l border-border pl-4 text-sm">
                      {timeline.map((entry, index) => (
                        <li key={index}>
                          <p className="font-medium">{entry.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(entry.occurredAt)} — {entry.actorName}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                {selectedEscalation.status === "resolved" ? (
                  <section className="rounded-md border border-success/20 bg-success/10 p-4 text-sm">
                    <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Resolution
                    </h2>
                    <p className="font-medium">
                      {selectedEscalation.outcome_category
                        ? OUTCOME_CATEGORY_LABEL[selectedEscalation.outcome_category] ?? selectedEscalation.outcome_category
                        : "Resolved"}
                    </p>
                    {selectedEscalation.resolution_notes ? <p className="mt-1">{selectedEscalation.resolution_notes}</p> : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Resolved {formatDateTime(selectedEscalation.resolved_at)} by{" "}
                      {selectedEscalation.resolved_by ? staffNameById.get(selectedEscalation.resolved_by) ?? "Unknown" : "Unknown"}
                    </p>
                  </section>
                ) : (
                  <section>
                    <h2 className="mb-2 text-sm font-medium">Resolution</h2>
                    {isCritical && !canResolveCritical ? (
                      <p className="mb-2 text-sm text-warning">
                        Only the Clinical Director or an admin can resolve a critical case.
                      </p>
                    ) : null}
                    <form action={resolveEscalation.bind(null, selectedEscalation.id)} className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="outcomeCategory" className="text-sm font-medium">
                          Outcome category{isCritical ? " (required for critical cases)" : ""}
                        </label>
                        <select
                          id="outcomeCategory"
                          name="outcomeCategory"
                          defaultValue=""
                          className="rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <option value="" disabled>
                            Select an outcome
                          </option>
                          {OUTCOME_CATEGORIES.map((category) => (
                            <option key={category.value} value={category.value}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="resolutionNotes" className="text-sm font-medium">
                          Resolution note{isCritical ? " (required for critical cases)" : ""}
                        </label>
                        <textarea
                          id="resolutionNotes"
                          name="resolutionNotes"
                          rows={3}
                          className="rounded-md border border-border px-3 py-2 text-sm"
                          placeholder="What was found and what was done"
                        />
                      </div>
                      <div>
                        <ConfirmSubmitButton
                          size="sm"
                          variant={isCritical ? "destructive" : "default"}
                          disabled={isCritical && !canResolveCritical}
                          confirmTitle="Resolve this case?"
                          confirmDescription={
                            <>
                              This closes the case for{" "}
                              <strong>{clientNameById.get(selectedEscalation.client_id) ?? "this client"}</strong> and
                              cannot be reopened from here.
                            </>
                          }
                          confirmLabel="Resolve case"
                        >
                          Resolve case
                        </ConfirmSubmitButton>
                      </div>
                    </form>
                  </section>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="flex w-full max-w-3xl flex-col gap-3">
          <h2 className="text-lg font-medium">Late & missed visits</h2>
          <DataTable
            rows={lateVisits}
            rowKey={(visit) => visit.id}
            emptyMessage="No overdue visits."
            columns={[
              { key: "client", header: "Client", render: (visit) => clientNameById.get(visit.client_id) ?? visit.client_id },
              { key: "provider", header: "Provider", render: (visit) => providerNameById.get(visit.provider_id) ?? visit.provider_id },
              { key: "scheduled_end", header: "Scheduled end", render: (visit) => formatDateTime(visit.scheduled_end) },
              { key: "status", header: "Status", render: (visit) => visit.status },
            ]}
          />
        </section>

        <section className="flex w-full max-w-3xl flex-col gap-3">
          <h2 className="text-lg font-medium">Credential expiry</h2>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Expiring within 30 days</h3>
            <DataTable
              rows={sortedExpiringCredentials}
              rowKey={(credential) => credential.id}
              emptyMessage="Nothing expiring soon."
              columns={[
                { key: "provider", header: "Provider", render: (c) => providerNameById.get(c.provider_id) ?? c.provider_id },
                { key: "credential", header: "Credential", render: (c) => credentialTypeLabelById.get(c.credential_type_id) ?? "—" },
                { key: "expiry", header: "Expires", render: (c) => formatDate(c.expiry_date) },
              ]}
            />
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
      </div>
    </AppShell>
  );
}
