import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RosterForm } from "./roster-form";

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  await requireStaffUser();
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
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Roster</h1>
      {added ? <p className="text-sm text-emerald-700">Roster assignment added.</p> : null}
      <RosterForm providers={providerOptions} zones={zoneOptions} error={error} />

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-2">Provider</th>
            <th className="py-2">Zone</th>
            <th className="py-2">Week starting</th>
          </tr>
        </thead>
        <tbody>
          {(rosterRows ?? []).map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2">{providerLabelById.get(row.provider_id) ?? row.provider_id}</td>
              <td className="py-2">{zoneLabelById.get(row.zone_id) ?? row.zone_id}</td>
              <td className="py-2">{row.week_starting}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
