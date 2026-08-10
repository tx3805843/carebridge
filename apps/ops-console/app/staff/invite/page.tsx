import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StaffInviteForm } from "./staff-invite-form";

const INVITABLE_ROLE_SLUGS = ["coordinator", "clinical_director", "nurse", "caregiver", "admin"];

export default async function StaffInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invited?: string }>;
}) {
  await requireStaffUser();
  const { error, invited } = await searchParams;

  const supabase = await createClient();
  const { data: roles } = await supabase
    .from("role")
    .select("slug, label")
    .in("slug", INVITABLE_ROLE_SLUGS)
    .order("label");

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Invite a staff member</h1>
      {invited ? <p className="text-sm text-emerald-700">Invited {invited}.</p> : null}
      <StaffInviteForm roles={roles ?? []} error={error} />
    </main>
  );
}
