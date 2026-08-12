import { PageHeader } from "@carebridge/ui";
import { createClient } from "@/lib/supabase/server";
import { NewSubscriptionForm } from "./subscription-form";

export default async function NewSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: clients } = await supabase.from("client").select("id, full_name").order("full_name");

  return (
    <>
    <PageHeader title="New subscription" />
    <NewSubscriptionForm
      clients={(clients ?? []).map((client) => ({ id: client.id, label: client.full_name }))}
      error={error}
    />
    </>
  );
}
