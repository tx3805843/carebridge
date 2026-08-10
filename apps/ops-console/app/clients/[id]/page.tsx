import { notFound } from "next/navigation";
import { Button, ConfirmSubmitButton, DataTable, EntitySummaryCard, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { grantAuthority, revokeAuthority, grantConsent, revokeConsent, recordConsent } from "./actions";
import { AUTHORITY_TYPES, CONSENT_SCOPES } from "./constants";

interface ConsentRecordRow {
  id: string;
  document_ref: string;
  signed_at: string;
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; updated?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { id } = await params;
  const { error, updated } = await searchParams;

  const supabase = await createClient();

  const { data: client } = await supabase
    .from("client")
    .select("id, full_name, date_of_birth, zone_id")
    .eq("id", id)
    .maybeSingle();

  if (!client) {
    notFound();
  }

  const [{ data: zone }, { data: sponsors }, { data: authorityGrants }, { data: consentRecords }] = await Promise.all([
    supabase.from("zone").select("name").eq("id", client.zone_id).maybeSingle(),
    supabase.from("family_sponsor").select("id, user_id, relationship").eq("client_id", client.id),
    supabase
      .from("authority_grant")
      .select("id, sponsor_id, authority_type, status, evidence_document_ref, effective_from, effective_until")
      .eq("client_id", client.id),
    supabase
      .from("consent_record")
      .select("id, document_ref, signed_at")
      .eq("client_id", client.id)
      .order("signed_at", { ascending: false }),
  ]);

  const sponsorUserIds = (sponsors ?? []).map((sponsor) => sponsor.user_id);

  const [{ data: sponsorUsers }, { data: consentGrants }] = await Promise.all([
    sponsorUserIds.length > 0
      ? supabase.from("user").select("id, full_name, email").in("id", sponsorUserIds)
      : Promise.resolve({ data: [] }),
    sponsorUserIds.length > 0
      ? supabase
          .from("consent_grant")
          .select("id, grantee_user_id, scope, granted_at, revoked_at")
          .eq("client_id", client.id)
          .in("grantee_user_id", sponsorUserIds)
      : Promise.resolve({ data: [] }),
  ]);

  const sponsorUserById = new Map((sponsorUsers ?? []).map((user) => [user.id, user]));

  return (
    <AppShell user={staffUser}>
      <EntitySummaryCard
        title={client.full_name}
        subtitle={zone?.name ?? "No zone"}
        meta={[{ label: "DOB", value: formatDate(client.date_of_birth) }]}
      />

      {updated ? <p className="mb-4 text-sm text-success">Updated.</p> : null}
      {error ? <p className="mb-4 text-sm text-critical">{error}</p> : null}

      <div className="flex flex-col gap-10">
        <section className="flex w-full max-w-2xl flex-col gap-3">
          <h2 className="text-lg font-medium">Client consent to receive care</h2>
          <DataTable<ConsentRecordRow>
            rows={consentRecords ?? []}
            rowKey={(row) => row.id}
            emptyMessage="No signed consent recorded yet."
            columns={[
              { key: "document", header: "Document", render: (row) => row.document_ref },
              { key: "signed", header: "Signed", render: (row) => formatDate(row.signed_at) },
            ]}
          />
          <form
            action={recordConsent.bind(null, client.id)}
            className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4"
          >
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Document ref
              <input name="documentRef" required className="rounded-md border border-border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Signed at
              <input type="date" name="signedAt" className="rounded-md border border-border px-3 py-2" />
            </label>
            <Button type="submit" size="sm">
              Record consent
            </Button>
          </form>
        </section>

        <section className="flex w-full max-w-3xl flex-col gap-6">
          <h2 className="text-lg font-medium">Family sponsors & authority</h2>
          {(sponsors ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No sponsors linked yet.</p>
          ) : (
            (sponsors ?? []).map((sponsor) => {
              const sponsorUser = sponsorUserById.get(sponsor.user_id);

              return (
                <div key={sponsor.id} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
                  <div>
                    <p className="font-medium">{sponsorUser?.full_name ?? "Unknown sponsor"}</p>
                    <p className="text-sm text-muted-foreground">
                      {sponsor.relationship} · {sponsorUser?.email ?? "no email"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    {AUTHORITY_TYPES.map((type) => {
                      const activeGrant = (authorityGrants ?? []).find(
                        (grant) =>
                          grant.sponsor_id === sponsor.id && grant.authority_type === type.value && grant.status === "active",
                      );
                      const pendingGrant = (authorityGrants ?? []).find(
                        (grant) =>
                          grant.sponsor_id === sponsor.id && grant.authority_type === type.value && grant.status === "pending",
                      );
                      const badge = activeGrant
                        ? ({ variant: "success", label: "Captured" } as const)
                        : pendingGrant
                          ? ({ variant: "warning", label: "Needs review" } as const)
                          : ({ variant: "neutral", label: "Not granted" } as const);

                      return (
                        <div
                          key={type.value}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{type.label}</span>
                            <StatusBadge variant={badge.variant} label={badge.label} />
                            {activeGrant?.evidence_document_ref ? (
                              <span className="text-xs text-muted-foreground">
                                Evidence: {activeGrant.evidence_document_ref}
                              </span>
                            ) : null}
                          </div>
                          {activeGrant ? (
                            <form action={revokeAuthority.bind(null, client.id)}>
                              <input type="hidden" name="authorityGrantId" value={activeGrant.id} />
                              <ConfirmSubmitButton
                                size="sm"
                                variant="destructive"
                                confirmTitle="Revoke this authority?"
                                confirmDescription={
                                  <>
                                    This revokes <strong>{type.label}</strong> for{" "}
                                    <strong>{sponsorUser?.full_name ?? "this sponsor"}</strong>.
                                  </>
                                }
                                confirmLabel="Revoke"
                              >
                                Revoke
                              </ConfirmSubmitButton>
                            </form>
                          ) : (
                            <form action={grantAuthority.bind(null, client.id)} className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="sponsorId" value={sponsor.id} />
                              <input type="hidden" name="authorityType" value={type.value} />
                              <input
                                name="evidenceDocumentRef"
                                placeholder="Evidence ref (optional)"
                                className="rounded-md border border-border px-2 py-1 text-xs"
                              />
                              <input
                                type="date"
                                name="effectiveFrom"
                                aria-label="Effective from"
                                className="rounded-md border border-border px-2 py-1 text-xs"
                              />
                              <input
                                type="date"
                                name="effectiveUntil"
                                aria-label="Effective until"
                                className="rounded-md border border-border px-2 py-1 text-xs"
                              />
                              <Button type="submit" size="sm" variant="outline">
                                Grant
                              </Button>
                            </form>
                          )}
                        </div>
                      );
                    })}

                    {CONSENT_SCOPES.map((scope) => {
                      const grant = (consentGrants ?? []).find(
                        (row) => row.grantee_user_id === sponsor.user_id && row.scope === scope.value && !row.revoked_at,
                      );
                      const badge = grant
                        ? ({ variant: "success", label: "Captured" } as const)
                        : ({ variant: "neutral", label: "Not granted" } as const);

                      return (
                        <div
                          key={scope.value}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{scope.label}</span>
                            <StatusBadge variant={badge.variant} label={badge.label} />
                          </div>
                          {grant ? (
                            <form action={revokeConsent.bind(null, client.id)}>
                              <input type="hidden" name="consentGrantId" value={grant.id} />
                              <ConfirmSubmitButton
                                size="sm"
                                variant="destructive"
                                confirmTitle="Revoke this consent?"
                                confirmDescription={
                                  <>
                                    This revokes <strong>{scope.label}</strong> for{" "}
                                    <strong>{sponsorUser?.full_name ?? "this sponsor"}</strong>.
                                  </>
                                }
                                confirmLabel="Revoke"
                              >
                                Revoke
                              </ConfirmSubmitButton>
                            </form>
                          ) : (
                            <form action={grantConsent.bind(null, client.id)}>
                              <input type="hidden" name="sponsorId" value={sponsor.id} />
                              <input type="hidden" name="scope" value={scope.value} />
                              <Button type="submit" size="sm" variant="outline">
                                Grant
                              </Button>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </AppShell>
  );
}
