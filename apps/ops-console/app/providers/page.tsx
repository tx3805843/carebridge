import Link from "next/link";
import { buttonVariants } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function flagBadge(label: string, value: boolean) {
  return (
    <span className={value ? "text-emerald-700" : "text-muted-foreground"}>
      {value ? "✓" : "–"} {label}
    </span>
  );
}

export default async function ProvidersPage() {
  await requireStaffUser();

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
    <main className="flex min-h-screen flex-col items-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">Providers</h1>
      <Link href="/providers/new" className={buttonVariants()}>
        Onboard a provider
      </Link>

      <table className="w-full max-w-3xl text-left text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-2">Name</th>
            <th className="py-2">Role</th>
            <th className="py-2">Experience</th>
            <th className="py-2">Status</th>
            <th className="py-2">Verification</th>
          </tr>
        </thead>
        <tbody>
          {(providers ?? []).map((provider) => {
            const user = userById.get(provider.user_id);
            const roleSlug = user ? roleSlugById.get(user.role_id) : undefined;
            const profile = verifiedProfileByProviderId.get(provider.id);

            return (
              <tr key={provider.id} className="border-t border-border">
                <td className="py-2">
                  <Link href={`/providers/${provider.id}`} className="underline">
                    {user?.full_name ?? "Unnamed provider"}
                  </Link>
                </td>
                <td className="py-2 capitalize">{roleSlug ?? "—"}</td>
                <td className="py-2">{provider.years_experience} yrs</td>
                <td className="py-2 capitalize">{provider.employment_status.replace("_", " ")}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    {flagBadge("ID", profile?.id_verified ?? false)}
                    {flagBadge("NMC", profile?.nmc_licensed ?? false)}
                    {flagBadge("Background", profile?.background_checked ?? false)}
                    {flagBadge("Training", profile?.training_current ?? false)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
