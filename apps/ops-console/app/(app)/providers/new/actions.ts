"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function onboardProvider(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const yearsExperience = String(formData.get("yearsExperience") ?? "0");
  const photoUrl = String(formData.get("photoUrl") ?? "").trim();

  if (!userId) {
    redirect(`/providers/new?error=${encodeURIComponent("Select a nurse or caregiver to onboard.")}`);
  }

  const supabase = await createClient();

  const { data: provider, error: providerError } = await supabase
    .from("provider")
    .insert({
      user_id: userId,
      years_experience: Number(yearsExperience) || 0,
      photo_url: photoUrl || null,
    })
    .select("id")
    .single();

  if (providerError || !provider) {
    redirect(`/providers/new?error=${encodeURIComponent(providerError?.message ?? "Failed to create provider.")}`);
  }

  redirect(`/providers/${provider.id}?onboarded=1`);
}
