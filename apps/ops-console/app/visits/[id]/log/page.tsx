import { notFound } from "next/navigation";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LogVisitForm } from "./log-form";
import { logVisitOutcome } from "./actions";

export default async function LogVisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaffUser();
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visit")
    .select("id, client_id, provider_id, scheduled_start, scheduled_end, status")
    .eq("id", id)
    .maybeSingle();

  if (!visit) {
    notFound();
  }

  const [{ data: client }, { data: provider }] = await Promise.all([
    supabase.from("client").select("full_name").eq("id", visit.client_id).maybeSingle(),
    supabase.from("provider").select("user_id").eq("id", visit.provider_id).maybeSingle(),
  ]);

  const providerName = provider
    ? (await supabase.from("user").select("full_name").eq("id", provider.user_id).maybeSingle()).data?.full_name
    : undefined;

  const boundAction = logVisitOutcome.bind(null, visit.id);

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Log visit outcome</h1>
      <p className="text-muted-foreground">
        {client?.full_name ?? "Unknown client"} with {providerName ?? "unknown provider"} —{" "}
        {new Date(visit.scheduled_start).toLocaleString()}
      </p>
      <LogVisitForm action={boundAction} error={error} />
    </main>
  );
}
