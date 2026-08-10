import { notFound } from "next/navigation";
import { Button } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

export default async function ProviderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; added?: string; updated?: string; onboarded?: string }>;
}) {
  await requireStaffUser();
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
    <main className="flex min-h-screen flex-col items-center gap-8 p-24">
      <h1 className="text-2xl font-semibold">{user?.full_name ?? "Unnamed provider"}</h1>
      <p className="text-muted-foreground">
        {user?.email ?? "no email"} · {user?.phone ?? "no phone"} · {provider.years_experience} yrs experience
      </p>

      {onboarded ? <p className="text-sm text-emerald-700">Provider onboarded.</p> : null}
      {added ? <p className="text-sm text-emerald-700">Added {added}.</p> : null}
      {updated ? <p className="text-sm text-emerald-700">Updated {updated}.</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

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
              Departed {new Date(provider.departed_at).toLocaleDateString()}
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
            NMC licensed (scheduling eligibility — recomputed nightly by the credential-expiry cron once an NMC
            PIN/AIN credential is logged; this toggle is a manual stopgap between now and the next run)
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
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-2">Type</th>
              <th className="py-2">Issuing authority</th>
              <th className="py-2">Status</th>
              <th className="py-2">Expiry</th>
            </tr>
          </thead>
          <tbody>
            {(credentials ?? []).map((credential) => (
              <tr key={credential.id} className="border-t border-border">
                <td className="py-2">{credentialTypeLabelById.get(credential.credential_type_id) ?? "—"}</td>
                <td className="py-2">{credential.issuing_authority}</td>
                <td className="py-2">{credential.status}</td>
                <td className="py-2">{credential.expiry_date ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

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
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-2">Vendor</th>
              <th className="py-2">Status</th>
              <th className="py-2">Verified at</th>
            </tr>
          </thead>
          <tbody>
            {(identityVerifications ?? []).map((iv) => (
              <tr key={iv.id} className="border-t border-border">
                <td className="py-2">{iv.vendor}</td>
                <td className="py-2">{iv.status}</td>
                <td className="py-2">{iv.verified_at ? new Date(iv.verified_at).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-2">Status</th>
              <th className="py-2">Document ref</th>
              <th className="py-2">Expires</th>
            </tr>
          </thead>
          <tbody>
            {(backgroundChecks ?? []).map((check) => (
              <tr key={check.id} className="border-t border-border">
                <td className="py-2">{check.status}</td>
                <td className="py-2">{check.document_ref}</td>
                <td className="py-2">{check.expires_at ? new Date(check.expires_at).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-2">Title</th>
              <th className="py-2">CPD points</th>
              <th className="py-2">Completed</th>
            </tr>
          </thead>
          <tbody>
            {(trainingRecords ?? []).map((record) => (
              <tr key={record.id} className="border-t border-border">
                <td className="py-2">{record.title}</td>
                <td className="py-2">{record.cpd_points}</td>
                <td className="py-2">{new Date(record.completed_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </main>
  );
}
