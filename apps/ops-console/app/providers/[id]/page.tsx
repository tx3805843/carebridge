import { notFound } from "next/navigation";
import { Button, DataTable, EntitySummaryCard } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import {
  addBackgroundCheck,
  addCredential,
  addIdentityVerification,
  addTrainingRecord,
  logCredentialVerification,
  updateEmploymentStatus,
  updateVerifiedProfile,
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
    { data: verifiedProfile },
    { data: credentials },
    { data: credentialTypes },
    { data: identityVerifications },
    { data: backgroundChecks },
    { data: trainingRecords },
  ] = await Promise.all([
    supabase.from("user").select("full_name, email, phone").eq("id", provider.user_id).maybeSingle(),
    supabase.from("verified_profile").select("*").eq("provider_id", provider.id).maybeSingle(),
    supabase
      .from("credential")
      .select("id, credential_type_id, issuing_authority, status, expiry_date")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase.from("credential_type").select("id, label").order("label"),
    supabase
      .from("identity_verification")
      .select("id, vendor, status, verified_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("background_check")
      .select("id, status, document_ref, expires_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("training_record")
      .select("id, title, cpd_points, completed_at")
      .eq("provider_id", provider.id)
      .order("completed_at", { ascending: false }),
  ]);

  const credentialTypeLabelById = new Map((credentialTypes ?? []).map((type) => [type.id, type.label]));

  const boundUpdateEmploymentStatus = updateEmploymentStatus.bind(null, provider.id);
  const boundAddCredential = addCredential.bind(null, provider.id);
  const boundLogVerification = logCredentialVerification.bind(null, provider.id);
  const boundAddIdentity = addIdentityVerification.bind(null, provider.id);
  const boundAddBackgroundCheck = addBackgroundCheck.bind(null, provider.id);
  const boundAddTraining = addTrainingRecord.bind(null, provider.id);
  const boundUpdateProfile = updateVerifiedProfile.bind(null, provider.id);

  return (
    <AppShell user={staffUser}>
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
        <form action={boundUpdateProfile} className="flex flex-col gap-3 rounded-md border border-border p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="idVerified" defaultChecked={verifiedProfile?.id_verified ?? false} />
            ID verified
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="nmcLicensed" defaultChecked={verifiedProfile?.nmc_licensed ?? false} />
            NMC licensed (scheduling eligibility — recomputed automatically each night once an NMC
            PIN/AIN credential is logged; this toggle is a manual stopgap between now and the next
            automatic check)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="backgroundChecked"
              defaultChecked={verifiedProfile?.background_checked ?? false}
            />
            Background checked
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="trainingCurrent" defaultChecked={verifiedProfile?.training_current ?? false} />
            Training current
          </label>
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
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
    </AppShell>
  );
}
