"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function onboardClient(formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const dateOfBirth = String(formData.get("dateOfBirth") ?? "");
  const address = String(formData.get("address") ?? "").trim();
  const zoneId = String(formData.get("zoneId") ?? "");
  const careSummary = String(formData.get("careSummary") ?? "").trim();
  const reviewDueAt = String(formData.get("reviewDueAt") ?? "");
  const referralSource = String(formData.get("referralSource") ?? "");

  if (!fullName || !dateOfBirth || !address || !zoneId || !careSummary) {
    redirect(
      `/clients/new?error=${encodeURIComponent("Client name, date of birth, address, zone, and care plan summary are all required.")}`,
    );
  }

  const contactNames = formData.getAll("contactFullName").map(String);
  const contactPhones = formData.getAll("contactPhone").map(String);
  const contacts = contactNames
    .map((name, index) => ({ fullName: name.trim(), phone: (contactPhones[index] ?? "").trim() }))
    .filter((contact) => contact.fullName && contact.phone);

  if (contacts.length === 0) {
    redirect(
      `/clients/new?error=${encodeURIComponent("At least one emergency contact (name and phone) is required.")}`,
    );
  }

  const sponsorRowCount = Number(formData.get("sponsorRowCount") ?? "0");
  const sponsors = Array.from({ length: sponsorRowCount }, (_, index) => ({
    email: String(formData.get(`sponsorEmail-${index}`) ?? "").trim(),
    fullName: String(formData.get(`sponsorFullName-${index}`) ?? "").trim(),
    relationship: String(formData.get(`sponsorRelationship-${index}`) ?? "").trim(),
    isDecisionMaker: formData.get(`sponsorIsDecisionMaker-${index}`) === "on",
    isBillingResponsible: formData.get(`sponsorIsBillingResponsible-${index}`) === "on",
  })).filter((sponsor) => sponsor.email && sponsor.fullName && sponsor.relationship);

  if (sponsors.length === 0) {
    redirect(
      `/clients/new?error=${encodeURIComponent("At least one family sponsor (email, name, relationship) is required.")}`,
    );
  }

  const supabase = await createClient();

  // Resolve every sponsor's user_id (existing account, or a new one) *before* writing anything
  // to the client's own tables. GoTrue account creation is an Auth API call, not SQL, so it
  // can't be part of the transaction below — doing it first means a failure here leaves zero
  // rows written, instead of orphaning an already-created client (the bug this fixes).
  const adminClient = createAdminClient();
  const resolvedSponsors: {
    userId: string;
    relationship: string;
    isDecisionMaker: boolean;
    isBillingResponsible: boolean;
  }[] = [];

  for (const sponsor of sponsors) {
    const { data: existingUser } = await supabase
      .from("user")
      .select("id")
      .ilike("email", sponsor.email)
      .maybeSingle();

    let userId = existingUser?.id;

    if (!userId) {
      const { data: created, error: createUserError } = await adminClient.auth.admin.createUser({
        email: sponsor.email,
        email_confirm: false,
        user_metadata: { full_name: sponsor.fullName },
      });

      if (createUserError || !created.user) {
        redirect(
          `/clients/new?error=${encodeURIComponent(`Sponsor account for ${sponsor.email} failed: ${createUserError?.message ?? "unknown error"}. No client was created — fix and resubmit.`)}`,
        );
      }

      userId = created.user.id;
    }

    resolvedSponsors.push({
      userId,
      relationship: sponsor.relationship,
      isDecisionMaker: sponsor.isDecisionMaker,
      isBillingResponsible: sponsor.isBillingResponsible,
    });
  }

  // Everything below writes in one Postgres transaction (see
  // 20260810050000_transactional_client_onboarding.sql) — either the whole client + care plan +
  // contacts + sponsor links land, or none of it does. `security invoker`: still gated by each
  // table's own staff-only RLS policy, same as the separate inserts this replaced.
  const { data: clientId, error: onboardError } = await supabase.rpc(
    "onboard_client_with_care_team",
    {
      p_full_name: fullName,
      p_date_of_birth: dateOfBirth,
      p_address: address,
      p_zone_id: zoneId,
      p_care_summary: careSummary,
      p_referral_source: referralSource || undefined,
      p_review_due_at: reviewDueAt || undefined,
      p_contacts: contacts.map((contact) => ({ full_name: contact.fullName, phone: contact.phone })),
      p_sponsors: resolvedSponsors.map((sponsor) => ({
        user_id: sponsor.userId,
        relationship: sponsor.relationship,
        is_decision_maker: sponsor.isDecisionMaker,
        is_billing_responsible: sponsor.isBillingResponsible,
      })),
    },
  );

  if (onboardError || !clientId) {
    redirect(
      `/clients/new?error=${encodeURIComponent(`Onboarding failed, nothing was saved: ${onboardError?.message ?? "unknown error"}. Sponsor account(s) may already exist — resubmitting is safe.`)}`,
    );
  }

  redirect(`/?onboarded=${clientId}`);
}
