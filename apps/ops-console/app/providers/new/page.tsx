import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProviderOnboardForm } from "./provider-form";

export default async function NewProviderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaffUser();
  const { error } = await searchParams;

  const supabase = await createClient();

  const [{ data: roles }, { data: providers }] = await Promise.all([
    supabase.from("role").select("id, slug").in("slug", ["nurse", "caregiver"]),
    supabase.from("provider").select("user_id"),
  ]);

  const roleIds = (roles ?? []).map((role) => role.id);
  const existingProviderUserIds = new Set((providers ?? []).map((provider) => provider.user_id));

  const { data: candidateUsers } =
    roleIds.length > 0
      ? await supabase.from("user").select("id, full_name, email").in("role_id", roleIds)
      : { data: [] };

  const userOptions = (candidateUsers ?? [])
    .filter((user) => !existingProviderUserIds.has(user.id))
    .map((user) => ({ id: user.id, label: `${user.full_name} (${user.email ?? "no email"})` }));

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Onboard a provider</h1>
      <ProviderOnboardForm users={userOptions} error={error} />
    </main>
  );
}
