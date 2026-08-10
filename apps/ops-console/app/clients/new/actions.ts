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

  const { data: client, error: clientError } = await supabase
    .from("client")
    .insert({ full_name: fullName, date_of_birth: dateOfBirth, address, zone_id: zoneId })
    .select("id")
    .single();

  if (clientError || !client) {
    redirect(
      `/clients/new?error=${encodeURIComponent(clientError?.message ?? "Failed to create client.")}`,
    );
  }

  const { error: carePlanError } = await supabase.from("care_plan").insert({
    client_id: client.id,
    summary: careSummary,
    review_due_at: reviewDueAt || null,
  });

  if (carePlanError) {
    redirect(
      `/clients/new?error=${encodeURIComponent(`Client was created (id ${client.id}) but the care plan failed to save: ${carePlanError.message}. Add the care plan manually.`)}`,
    );
  }

  const { error: contactsError } = await supabase.from("emergency_contact").insert(
    contacts.map((contact, index) => ({
      client_id: client.id,
      full_name: contact.fullName,
      phone: contact.phone,
      priority: index + 1,
    })),
  );

  if (contactsError) {
    redirect(
      `/clients/new?error=${encodeURIComponent(`Client and care plan were created (id ${client.id}) but emergency contacts failed to save: ${contactsError.message}. Add them manually.`)}`,
    );
  }

  const adminClient = createAdminClient();
  let decisionMakerPriority = 1;

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
          `/clients/new?error=${encodeURIComponent(`Client, care plan, and emergency contacts were created (id ${client.id}), but the sponsor account for ${sponsor.email} failed: ${createUserError?.message ?? "unknown error"}. Link this sponsor manually.`)}`,
        );
      }

      userId = created.user.id;
    }

    const { data: familySponsor, error: familySponsorError } = await supabase
      .from("family_sponsor")
      .insert({ user_id: userId, client_id: client.id, relationship: sponsor.relationship })
      .select("id")
      .single();

    if (familySponsorError || !familySponsor) {
      redirect(
        `/clients/new?error=${encodeURIComponent(`Client (id ${client.id}) was created but linking sponsor ${sponsor.email} failed: ${familySponsorError?.message ?? "unknown error"}. Link this sponsor manually.`)}`,
      );
    }

    const { error: relationshipError } = await supabase.from("client_relationship").insert({
      client_id: client.id,
      sponsor_id: familySponsor.id,
      is_decision_maker: sponsor.isDecisionMaker,
      is_billing_responsible: sponsor.isBillingResponsible,
    });

    if (relationshipError) {
      redirect(
        `/clients/new?error=${encodeURIComponent(`Client (id ${client.id}) and sponsor ${sponsor.email} were created but the relationship record failed to save: ${relationshipError.message}. Add it manually.`)}`,
      );
    }

    if (sponsor.isDecisionMaker) {
      const { error: hierarchyError } = await supabase.from("decision_maker_hierarchy").insert({
        client_id: client.id,
        sponsor_id: familySponsor.id,
        priority: decisionMakerPriority,
      });

      if (hierarchyError) {
        redirect(
          `/clients/new?error=${encodeURIComponent(`Client (id ${client.id}) and sponsor ${sponsor.email} were created but the decision-maker ordering failed to save: ${hierarchyError.message}. Add it manually.`)}`,
        );
      }

      decisionMakerPriority += 1;
    }
  }

  redirect(`/?onboarded=${client.id}`);
}
