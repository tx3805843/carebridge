import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { VisitForm } from "./visit-form";

export default async function NewVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaffUser();
  const { error } = await searchParams;

  const supabase = await createClient();

  const [{ data: clients }, { data: providers }] = await Promise.all([
    supabase.from("client").select("id, full_name").order("full_name"),
    supabase.from("provider").select("id, user_id"),
  ]);

  const providerUserIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: providerUsers } =
    providerUserIds.length > 0
      ? await supabase.from("user").select("id, full_name").in("id", providerUserIds)
      : { data: [] };

  const providerNameByUserId = new Map((providerUsers ?? []).map((user) => [user.id, user.full_name]));

  const clientOptions = (clients ?? []).map((client) => ({ id: client.id, label: client.full_name }));
  const providerOptions = (providers ?? []).map((provider) => ({
    id: provider.id,
    label: providerNameByUserId.get(provider.user_id) ?? "Unnamed provider",
  }));

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Schedule a visit</h1>
      <VisitForm clients={clientOptions} providers={providerOptions} error={error} />
    </main>
  );
}
