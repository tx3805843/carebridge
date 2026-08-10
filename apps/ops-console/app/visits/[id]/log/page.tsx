import { notFound } from "next/navigation";
import { EntitySummaryCard } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { LogVisitForm } from "./log-form";
import { logVisitOutcome } from "./actions";

export default async function LogVisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const staffUser = await requireStaffUser();
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
    <AppShell user={staffUser}>
      <EntitySummaryCard
        title="Log visit outcome"
        subtitle={`${client?.full_name ?? "Unknown client"} with ${providerName ?? "unknown provider"}`}
        meta={[{ label: "Scheduled", value: formatDateTime(visit.scheduled_start) }]}
      />
      <LogVisitForm action={boundAction} error={error} />
    </AppShell>
  );
}
