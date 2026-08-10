import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewSubscriptionForm } from "./subscription-form";

export default async function NewSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaffUser();
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: clients } = await supabase.from("client").select("id, full_name").order("full_name");

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">New subscription</h1>
      <NewSubscriptionForm
        clients={(clients ?? []).map((client) => ({ id: client.id, label: client.full_name }))}
        error={error}
      />
    </main>
  );
}
