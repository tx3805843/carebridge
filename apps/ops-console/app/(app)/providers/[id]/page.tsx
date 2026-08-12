import { notFound } from "next/navigation";
import { Button, ConfirmSubmitButton, DataTable, EntitySummaryCard, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { EXPIRY_WARNING_DAYS, getProviderVerificationBadges, type VerificationState } from "@/lib/provider-verification-status";
import { OVERRIDE_SIGNAL_LABEL, OVERRIDE_SIGNALS } from "./constants";
import {
  addBackgroundCheck,
  addCredential,
  addIdentityVerification,
  addTrainingRecord,
  createVerificationOverride,
  logCredentialVerification,
  revokeVerificationOverride,
  updateEmploymentStatus,
} from "./actions";

const EMPLOYMENT_STATUSES = ["active", "on_leave", "departed"];

const VERIFICATION_STATUSES = ["unverified", "pending", "verified", "expired", "rejected"];

interface CredentialRow {
  id: string;
  credential_type_id: string;
  issuing_authority: string;
  status: string;
  expiry_date: string | null;
}

interface IdentityVerificationRow {
  id: string;
  vendor: string;
  status: string;
  verified_at: string | null;
}

interface BackgroundCheckRow {
  id: string;
  status: string;
  document_ref: string;
  expires_at: string | null;
}

interface TrainingRecordRow {
  id: string;
  title: string;
  cpd_points: number;
  completed_at: string | null;
}

interface VerificationOverrideRow {
  id: string;
  signal: string;
  override_value: boolean;
  reason: string;
  effective_from: string;
  effective_until: string;
  revoked_at: string | null;
}

// Matches D1's own VERIFICATION_BADGE map in apps/ops-console/app/(app)/providers/page.tsx —
// duplicated here rather than shared, same small-array-duplication precedent already
// established between this file and its own actions.ts (VERIFICATION_STATUSES).
const VERIFICATION_BADGE: Record<
  VerificationState,
  { variant: "success" | "warning" | "critical" | "neutral"; label: string }
> = {
  verified: { variant: "success", label: "Verified" },
  expiring: { variant: "warning", label: "Expiring" },
  missing: { variant: "critical", label: "Missing" },
  not_applicable: { variant: "neutral", label: "N/A" },
};

function verificationBadge(signalLabel: string, state: VerificationState) {
  const { variant, label } = VERIFICATION_BADGE[state];
  return <StatusBadge variant={variant} label={`${signalLabel} — ${label}`} />;
}

export default async function ProviderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; added?: string; updated?: string; onboarded?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { id } = await params;
  const { error, added, updated, onboarded } = await searchParams;

  const supabase = await createClient();

  const { data: provider } = await supabase
    .from("provider")
    .select("id, user_id, years_experience, photo_url, employment_status, departed_at, departure_reason")
    .eq("id", id)
    .maybeSingle();

  if (!provider) {
    notFound();
  }

  const [
    { data: user },
    { data: credentials },
    { data: credentialTypes },
    { data: identityVerifications },
    { data: backgroundChecks },
    { data: trainingRecords },
    { data: roles },
    { data: overrides },
  ] = await Promise.all([
    supabase.from("user").select("full_name, email, phone, role_id").eq("id", provider.user_id).maybeSingle(),
    supabase
      .from("credential")
      .select("id, credential_type_id, issuing_authority, status, expiry_date, created_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase.from("credential_type").select("id, label, slug").order("label"),
    supabase
      .from("identity_verification")
      .select("id, vendor, status, verified_at, created_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("background_check")
      .select("id, status, document_ref, expires_at, created_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("training_record")
      .select("id, title, cpd_points, completed_at, created_at")
      .eq("provider_id", provider.id)
      .order("completed_at", { ascending: false }),
    supabase.from("role").select("id, slug"),
    supabase
      .from("verification_override")
      .select("id, signal, override_value, reason, effective_from, effective_until, revoked_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
  ]);

  const credentialTypeLabelById = new Map((credentialTypes ?? []).map((type) => [type.id, type.label]));

  const roleSlugById = new Map((roles ?? []).map((role) => [role.id, role.slug]));
  const isNurse = user ? roleSlugById.get(user.role_id) === "nurse" : false;

  const credentialTypeSlugById = new Map((credentialTypes ?? []).map((type) => [type.id, type.slug]));
  const nmcCredentials = (credentials ?? []).filter((c) => credentialTypeSlugById.get(c.credential_type_id) === "nmc_pin_ain");

  const todayIso = new Date().toISOString().slice(0, 10);
  const warningCutoffIso = new Date(Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const verificationBadges = getProviderVerificationBadges({
    isNurse,
    identityVerifications: (identityVerifications ?? []).map((row) => ({ status: row.status, createdAt: row.created_at })),
    nmcCredentials: nmcCredentials.map((row) => ({ status: row.status, expiryDate: row.expiry_date, createdAt: row.created_at })),
    backgroundChecks: (backgroundChecks ?? []).map((row) => ({ status: row.status, expiresAt: row.expires_at, createdAt: row.created_at })),
    trainingRecords: (trainingRecords ?? []).map((row) => ({ createdAt: row.created_at })),
    todayIso,
    warningCutoffIso,
  });

  const isApprover = staffUser.roleSlug === "clinical_director" || staffUser.roleSlug === "admin";

  const boundCreateOverride = createVerificationOverride.bind(null, provider.id);

  const boundUpdateEmploymentStatus = updateEmploymentStatus.bind(null, provider.id);
  const boundAddCredential = addCredential.bind(null, provider.id);
  const boundLogVerification = logCredentialVerification.bind(null, provider.id);
  const boundAddIdentity = addIdentityVerification.bind(null, provider.id);
  const boundAddBackgroundCheck = addBackgroundCheck.bind(null, provider.id);
  const boundAddTraining = addTrainingRecord.bind(null, provider.id);

  return (
    <>
      <EntitySummaryCard
        title={user?.full_name ?? "Unnamed provider"}
        subtitle={`${user?.email ?? "no email"} · ${user?.phone ?? "no phone"}`}
        meta={[{ label: "Experience", value: `${provider.years_experience} yrs` }]}
      />

      {onboarded ? <p className="text-sm text-success">Provider onboarded.</p> : null}
      {added ? <p className="text-sm text-success">Added {added}.</p> : null}
      {updated ? <p className="text-sm text-success">Updated {updated}.</p> : null}
      {error ? <p className="text-sm text-critical">{error}</p> : null}

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Employment status</h2>
        <form action={boundUpdateEmploymentStatus} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4">
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Status
            <select
              name="employmentStatus"
              defaultValue={provider.employment_status}
              className="rounded-md border border-border px-3 py-2"
            >
              {EMPLOYMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Departure reason (if departed)
            <input
              name="departureReason"
              defaultValue={provider.departure_reason ?? ""}
              className="rounded-md border border-border px-3 py-2"
            />
          </label>
          <Button type="submit" size="sm">
            Save
          </Button>
          {provider.departed_at ? (
            <p className="w-full text-xs text-muted-foreground">
              Departed {formatDate(provider.departed_at)}
            </p>
          ) : null}
        </form>
      </section>

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Verified profile</h2>
        <p className="text-sm text-muted-foreground">
          Computed automatically from the records below — not editable here. To temporarily
          correct a value, use an override below.
        </p>
        <div className="flex flex-wrap gap-2 rounded-md border border-border p-4">
          {verificationBadge("ID", verificationBadges.id)}
          {verificationBadge("NMC", verificationBadges.nmc)}
          {verificationBadge("Background", verificationBadges.background)}
          {verificationBadge("Training", verificationBadges.training)}
        </div>
      </section>

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Verification overrides</h2>
        <DataTable<VerificationOverrideRow>
          rows={overrides ?? []}
          rowKey={(row) => row.id}
          emptyMessage="No overrides on record."
          columns={[
            { key: "signal", header: "Signal", render: (row) => OVERRIDE_SIGNAL_LABEL[row.signal] ?? row.signal },
            { key: "value", header: "Value", render: (row) => (row.override_value ? "True" : "False") },
            { key: "reason", header: "Reason", render: (row) => row.reason },
            {
              key: "window",
              header: "Effective",
              render: (row) => `${formatDate(row.effective_from)} – ${formatDate(row.effective_until)}`,
            },
            {
              key: "state",
              header: "Status",
              render: (row) =>
                row.revoked_at ? (
                  <StatusBadge variant="neutral" label="Revoked" />
                ) : new Date(row.effective_until) < new Date() ? (
                  <StatusBadge variant="neutral" label="Expired" />
                ) : (
                  <StatusBadge variant="warning" label="Active" />
                ),
            },
            {
              key: "actions",
              header: "",
              render: (row) =>
                !row.revoked_at && new Date(row.effective_until) >= new Date() && isApprover ? (
                  <form action={revokeVerificationOverride.bind(null, provider.id, row.id)}>
                    <ConfirmSubmitButton
                      size="sm"
                      variant="outline"
                      confirmTitle="Revoke override"
                      confirmDescription={
                        <>
                          Revoke this override on <strong>{OVERRIDE_SIGNAL_LABEL[row.signal]}</strong>? The
                          computed value will apply again immediately.
                        </>
                      }
                      confirmLabel="Revoke"
                    >
                      Revoke
                    </ConfirmSubmitButton>
                  </form>
                ) : null,
            },
          ]}
        />

        {isApprover ? (
          <form action={boundCreateOverride} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4">
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Signal
              <select name="signal" required defaultValue="" className="rounded-md border border-border px-3 py-2">
                <option value="" disabled>
                  Select
                </option>
                {OVERRIDE_SIGNALS.map((signal) => (
                  <option key={signal} value={signal}>
                    {OVERRIDE_SIGNAL_LABEL[signal]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Value
              <select name="overrideValue" required defaultValue="" className="rounded-md border border-border px-3 py-2">
                <option value="" disabled>
                  Select
                </option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Reason
              <input name="reason" required className="rounded-md border border-border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Effective until
              <input type="date" name="effectiveUntil" required className="rounded-md border border-border px-3 py-2" />
            </label>
            <ConfirmSubmitButton
              size="sm"
              confirmTitle="Create override"
              confirmDescription="This overrides the computed verification status for this provider until the effective-until date. Confirm?"
              confirmLabel="Create override"
            >
              Create override
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </section>

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Credentials</h2>
        <DataTable<CredentialRow>
          rows={credentials ?? []}
          rowKey={(row) => row.id}
          emptyMessage="No credentials logged yet."
          columns={[
            { key: "type", header: "Type", render: (row) => credentialTypeLabelById.get(row.credential_type_id) ?? "—" },
            { key: "authority", header: "Issuing authority", render: (row) => row.issuing_authority },
            { key: "status", header: "Status", render: (row) => row.status },
            { key: "expiry", header: "Expiry", render: (row) => row.expiry_date ?? "—" },
          ]}
        />

        <form action={boundAddCredential} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4">
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Type
            <select name="credentialTypeId" required defaultValue="" className="rounded-md border border-border px-3 py-2">
              <option value="" disabled>
                Select
              </option>
              {(credentialTypes ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Issuing authority
            <input name="issuingAuthority" required className="rounded-md border border-border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Expiry date
            <input type="date" name="expiryDate" className="rounded-md border border-border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Evidence doc ref
            <input name="evidenceDocumentRef" className="rounded-md border border-border px-3 py-2" />
          </label>
          <Button type="submit" size="sm">
            Add credential
          </Button>
        </form>

        <form
          action={boundLogVerification}
          className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4"
        >
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Credential
            <select name="credentialId" required defaultValue="" className="rounded-md border border-border px-3 py-2">
              <option value="" disabled>
                Select
              </option>
              {(credentials ?? []).map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credentialTypeLabelById.get(credential.credential_type_id) ?? credential.id} —{" "}
                  {credential.issuing_authority}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Outcome
            <select name="outcome" required defaultValue="" className="rounded-md border border-border px-3 py-2">
              <option value="" disabled>
                Select
              </option>
              {VERIFICATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Notes
            <input name="notes" className="rounded-md border border-border px-3 py-2" />
          </label>
          <Button type="submit" size="sm" variant="outline">
            Log verification
          </Button>
        </form>
      </section>

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Identity verification</h2>
        <DataTable<IdentityVerificationRow>
          rows={identityVerifications ?? []}
          rowKey={(row) => row.id}
          emptyMessage="No identity verification logged yet."
          columns={[
            { key: "vendor", header: "Vendor", render: (row) => row.vendor },
            { key: "status", header: "Status", render: (row) => row.status },
            { key: "verified", header: "Verified at", render: (row) => formatDate(row.verified_at) },
          ]}
        />
        <form action={boundAddIdentity} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4">
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Vendor
            <select name="vendor" required defaultValue="" className="rounded-md border border-border px-3 py-2">
              <option value="" disabled>
                Select
              </option>
              <option value="smile_id">Smile ID</option>
              <option value="youverify">Youverify</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Status
            <select name="status" required defaultValue="" className="rounded-md border border-border px-3 py-2">
              <option value="" disabled>
                Select
              </option>
              {VERIFICATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Verified at
            <input type="date" name="verifiedAt" className="rounded-md border border-border px-3 py-2" />
          </label>
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      </section>

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Background checks</h2>
        <DataTable<BackgroundCheckRow>
          rows={backgroundChecks ?? []}
          rowKey={(row) => row.id}
          emptyMessage="No background checks logged yet."
          columns={[
            { key: "status", header: "Status", render: (row) => row.status },
            { key: "document", header: "Document ref", render: (row) => row.document_ref },
            { key: "expires", header: "Expires", render: (row) => formatDate(row.expires_at) },
          ]}
        />
        <form
          action={boundAddBackgroundCheck}
          className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4"
        >
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Status
            <select name="status" required defaultValue="" className="rounded-md border border-border px-3 py-2">
              <option value="" disabled>
                Select
              </option>
              {VERIFICATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Document ref
            <input name="documentRef" required className="rounded-md border border-border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Expires
            <input type="date" name="expiresAt" className="rounded-md border border-border px-3 py-2" />
          </label>
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      </section>

      <section className="flex w-full max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Training records</h2>
        <DataTable<TrainingRecordRow>
          rows={trainingRecords ?? []}
          rowKey={(row) => row.id}
          emptyMessage="No training records logged yet."
          columns={[
            { key: "title", header: "Title", render: (row) => row.title },
            { key: "cpd", header: "CPD points", render: (row) => row.cpd_points },
            { key: "completed", header: "Completed", render: (row) => formatDate(row.completed_at) },
          ]}
        />
        <form action={boundAddTraining} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4">
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Title
            <input name="title" required className="rounded-md border border-border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            CPD points
            <input type="number" step="0.5" min="0" name="cpdPoints" defaultValue="0" className="rounded-md border border-border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Completed at
            <input type="date" name="completedAt" className="rounded-md border border-border px-3 py-2" />
          </label>
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      </section>
    </>
  );
}
