import { PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { NewSubscriptionForm } from "./subscription-form";

export default async function NewSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: clients } = await supabase.from("client").select("id, full_name").order("full_name");

  return (
    <AppShell user={staffUser}>
      <PageHeader title="New subscription" />
      <NewSubscriptionForm
        clients={(clients ?? []).map((client) => ({ id: client.id, label: client.full_name }))}
        error={error}
      />
    </AppShell>
  );
}
