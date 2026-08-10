import Link from "next/link";
import { buttonVariants, DataTable, PageHeader, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

function flagBadge(label: string, value: boolean) {
  return <StatusBadge variant={value ? "success" : "neutral"} label={label} />;
}

interface ProviderRow {
  id: string;
  user_id: string;
  years_experience: number;
  employment_status: string;
}

export default async function ProvidersPage() {
  const staffUser = await requireStaffUser();

  const supabase = await createClient();

  const [{ data: providers }, { data: roles }] = await Promise.all([
    supabase
      .from("provider")
      .select("id, user_id, years_experience, employment_status")
      .order("created_at", { ascending: false }),
    supabase.from("role").select("id, slug"),
  ]);

  const roleSlugById = new Map((roles ?? []).map((role) => [role.id, role.slug]));

  const userIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: users } =
    userIds.length > 0
      ? await supabase.from("user").select("id, full_name, role_id").in("id", userIds)
      : { data: [] };
  const userById = new Map((users ?? []).map((user) => [user.id, user]));

  const providerIds = (providers ?? []).map((provider) => provider.id);
  const { data: verifiedProfiles } =
    providerIds.length > 0
      ? await supabase
          .from("verified_profile")
          .select("provider_id, id_verified, nmc_licensed, background_checked, training_current")
          .in("provider_id", providerIds)
      : { data: [] };
  const verifiedProfileByProviderId = new Map(
    (verifiedProfiles ?? []).map((profile) => [profile.provider_id, profile]),
  );

  return (
    <AppShell user={staffUser}>
      <PageHeader
        title="Providers"
        actions={
          <Link href="/providers/new" className={buttonVariants()}>
            Onboard a provider
          </Link>
        }
      />
      <DataTable<ProviderRow>
        rows={providers ?? []}
        rowKey={(row) => row.id}
        emptyMessage="No providers yet."
        columns={[
          {
            key: "name",
            header: "Name",
            render: (row) => (
              <Link href={`/providers/${row.id}`} className="underline">
                {userById.get(row.user_id)?.full_name ?? "Unnamed provider"}
              </Link>
            ),
          },
          {
            key: "role",
            header: "Role",
            render: (row) => {
              const user = userById.get(row.user_id);
              const roleSlug = user ? roleSlugById.get(user.role_id) : undefined;
              return <span className="capitalize">{roleSlug ?? "—"}</span>;
            },
          },
          { key: "experience", header: "Experience", render: (row) => `${row.years_experience} yrs` },
          {
            key: "status",
            header: "Status",
            render: (row) => <span className="capitalize">{row.employment_status.replace("_", " ")}</span>,
          },
          {
            key: "verification",
            header: "Verification",
            render: (row) => {
              const profile = verifiedProfileByProviderId.get(row.id);
              return (
                <div className="flex flex-wrap gap-2">
                  {flagBadge("ID", profile?.id_verified ?? false)}
                  {flagBadge("NMC", profile?.nmc_licensed ?? false)}
                  {flagBadge("Background", profile?.background_checked ?? false)}
                  {flagBadge("Training", profile?.training_current ?? false)}
                </div>
              );
            },
          },
        ]}
      />
    </AppShell>
  );
}
