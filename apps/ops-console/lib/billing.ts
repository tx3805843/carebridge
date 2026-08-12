import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@carebridge/domain";

// Same authority_grant -> family_sponsor -> user join lib/whatsapp.ts's private
// billingResponsibleSponsorUsers() already does (for phone, to send a WhatsApp message) —
// this selects full_name for display instead. Duplicated rather than shared: the two live in
// different modules selecting different columns, and this codebase already accepts this
// scale of duplication elsewhere (e.g. D1's EXPIRY_WARNING_DAYS constant) rather than forcing
// a premature shared abstraction across unrelated call sites.
export async function getBillingResponsibleSponsorName(
  supabase: SupabaseClient<Database>,
  clientId: string,
): Promise<string | null> {
  const { data: relationships } = await supabase
    .from("authority_grant")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("authority_type", "billing_responsible")
    .eq("status", "active");

  const sponsorIds = (relationships ?? []).map((r) => r.sponsor_id);
  if (sponsorIds.length === 0) return null;

  const { data: sponsors } = await supabase.from("family_sponsor").select("user_id").in("id", sponsorIds);
  const userIds = (sponsors ?? []).map((s) => s.user_id);
  if (userIds.length === 0) return null;

  const { data: users } = await supabase.from("user").select("full_name").in("id", userIds);
  return users?.[0]?.full_name ?? null;
}
