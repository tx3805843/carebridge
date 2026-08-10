import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewClientForm } from "./client-form";

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaffUser();
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: zones } = await supabase.from("zone").select("id, name").order("name");

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Onboard a new client</h1>
      <NewClientForm zones={zones ?? []} error={error} />
    </main>
  );
}
