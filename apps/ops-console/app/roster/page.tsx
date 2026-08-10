import { DataTable, PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { RosterForm } from "./roster-form";

interface RosterRow {
  id: string;
  provider_id: string;
  zone_id: string;
  week_starting: string;
}

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { error, added } = await searchParams;

  const supabase = await createClient();

  const [{ data: zones }, { data: providers }, { data: rosterRows }] = await Promise.all([
    supabase.from("zone").select("id, name").order("name"),
    supabase.from("provider").select("id, user_id"),
    supabase
      .from("roster")
      .select("id, provider_id, zone_id, week_starting")
      .order("week_starting", { ascending: false }),
  ]);

  const providerUserIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: providerUsers } =
    providerUserIds.length > 0
      ? await supabase.from("user").select("id, full_name").in("id", providerUserIds)
      : { data: [] };

  const providerNameByUserId = new Map((providerUsers ?? []).map((user) => [user.id, user.full_name]));
  const providerOptions = (providers ?? []).map((provider) => ({
    id: provider.id,
    label: providerNameByUserId.get(provider.user_id) ?? "Unnamed provider",
  }));
  const zoneOptions = (zones ?? []).map((zone) => ({ id: zone.id, label: zone.name }));

  const providerLabelById = new Map(providerOptions.map((provider) => [provider.id, provider.label]));
  const zoneLabelById = new Map(zoneOptions.map((zone) => [zone.id, zone.label]));

  return (
    <AppShell user={staffUser} toast={added ? { message: "Roster assignment added." } : undefined}>
      <PageHeader title="Roster" />
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <RosterForm providers={providerOptions} zones={zoneOptions} error={error} />

        <DataTable<RosterRow>
          rows={rosterRows ?? []}
          rowKey={(row) => row.id}
          emptyMessage="No roster assignments yet."
          columns={[
            { key: "provider", header: "Provider", render: (row) => providerLabelById.get(row.provider_id) ?? row.provider_id },
            { key: "zone", header: "Zone", render: (row) => zoneLabelById.get(row.zone_id) ?? row.zone_id },
            { key: "week", header: "Week starting", render: (row) => row.week_starting },
          ]}
        />
      </div>
    </AppShell>
  );
}
