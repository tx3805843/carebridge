"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// family_sponsor has its own dedicated flow (client onboarding, see app/clients/new/) and is
// deliberately excluded here — this form is for staff/provider account creation only.
const INVITABLE_ROLE_SLUGS = ["coordinator", "clinical_director", "nurse", "caregiver", "admin"];

export async function inviteStaffMember(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const roleSlug = String(formData.get("roleSlug") ?? "").trim();

  if (!email || !fullName || !roleSlug) {
    redirect(`/staff/invite?error=${encodeURIComponent("Email, full name, and role are all required.")}`);
  }

  if (!INVITABLE_ROLE_SLUGS.includes(roleSlug)) {
    redirect(`/staff/invite?error=${encodeURIComponent("Invalid role selected.")}`);
  }

  const supabase = await createClient();

  const { data: existingUser } = await supabase
    .from("user")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existingUser) {
    redirect(
      `/staff/invite?error=${encodeURIComponent(`${email} already has an account. Changing an existing user's role isn't supported from this form — update it directly if this is deliberate.`)}`,
    );
  }

  const { data: role, error: roleError } = await supabase
    .from("role")
    .select("id")
    .eq("slug", roleSlug)
    .single();

  if (roleError || !role) {
    redirect(`/staff/invite?error=${encodeURIComponent("Could not resolve the selected role.")}`);
  }

  const adminClient = createAdminClient();
  const { error: createUserError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: {
      full_name: fullName,
      phone: phone || undefined,
      role_id: role.id,
    },
  });

  if (createUserError) {
    redirect(`/staff/invite?error=${encodeURIComponent(createUserError.message)}`);
  }

  // Note: this creates the `user` row with the correct role only. For nurse/caregiver, the
  // corresponding `provider` row (years_experience, credentialing, etc.) is deliberately not
  // created here — that's the provider-onboarding epic's job (Phase 1, not yet built).
  redirect(`/staff/invite?invited=${encodeURIComponent(email)}`);
}
