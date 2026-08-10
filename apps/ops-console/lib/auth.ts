import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

const STAFF_ROLE_SLUGS = ["coordinator", "clinical_director", "admin"];

export async function requireStaffUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user")
    .select("role_id, full_name")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  const { data: role } = await supabase
    .from("role")
    .select("slug, label")
    .eq("id", profile.role_id)
    .single();

  if (!role || !STAFF_ROLE_SLUGS.includes(role.slug)) {
    redirect("/not-authorized");
  }

  return { id: user.id, fullName: profile.full_name, roleSlug: role.slug, roleLabel: role.label };
}
