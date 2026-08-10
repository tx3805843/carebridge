import { PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { VisitForm } from "./visit-form";

export default async function NewVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; visitScheduled?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { error, visitScheduled } = await searchParams;

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
    <AppShell user={staffUser}>
      <PageHeader title="Schedule a visit" />
      {visitScheduled ? <p className="mb-4 text-sm text-success">Visit scheduled.</p> : null}
      <VisitForm clients={clientOptions} providers={providerOptions} error={error} />
    </AppShell>
  );
}
