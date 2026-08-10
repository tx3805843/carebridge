import { PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { StaffInviteForm } from "./staff-invite-form";

const INVITABLE_ROLE_SLUGS = ["coordinator", "clinical_director", "nurse", "caregiver", "admin"];

export default async function StaffInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invited?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { error, invited } = await searchParams;

  const supabase = await createClient();
  const { data: roles } = await supabase
    .from("role")
    .select("slug, label")
    .in("slug", INVITABLE_ROLE_SLUGS)
    .order("label");

  return (
    <AppShell user={staffUser}>
      <PageHeader title="Create a staff account" />
      {invited ? (
        <p className="mb-4 text-sm text-success">
          Account created for {invited}. No email was sent — they cannot log in until a password
          is set for them.
        </p>
      ) : null}
      <StaffInviteForm roles={roles ?? []} error={error} />
    </AppShell>
  );
}
