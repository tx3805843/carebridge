import "server-only";
import { WhatsappClient, WHATSAPP_TEMPLATES } from "@carebridge/whatsapp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@carebridge/domain";

function getWhatsappClient(): WhatsappClient | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    return null;
  }

  return new WhatsappClient({ accessToken, phoneNumberId });
}

/**
 * Writes a `notification` row per recipient and attempts a best-effort WhatsApp send, logging
 * every attempt to `whatsapp_message_log`. Degrades to a logged, unsent row (no network call)
 * rather than throwing when WhatsApp isn't configured (Meta template approval is still
 * pending) or a recipient has no phone on file — never blocks the caller's own flow.
 */
async function notifyRecipients(
  supabase: SupabaseClient<Database>,
  recipients: { id: string; phone: string | null }[],
  templateName: string,
) {
  const client = getWhatsappClient();

  for (const recipient of recipients) {
    const { data: notification } = await supabase
      .from("notification")
      .insert({ user_id: recipient.id, channel: "whatsapp", template_id: templateName })
      .select("id")
      .single();

    if (!notification) {
      continue;
    }

    if (!client || !recipient.phone) {
      await supabase.from("whatsapp_message_log").insert({
        to_phone: recipient.phone ?? "unknown",
        template_name: templateName,
        status: "failed",
      });
      continue;
    }

    try {
      const { messageId } = await client.sendTemplateMessage({ to: recipient.phone, templateName });
      await supabase.from("whatsapp_message_log").insert({
        to_phone: recipient.phone,
        template_name: templateName,
        status: "sent",
        wa_message_id: messageId,
      });
      await supabase.from("notification").update({ sent_at: new Date().toISOString() }).eq("id", notification.id);
    } catch {
      await supabase.from("whatsapp_message_log").insert({
        to_phone: recipient.phone,
        template_name: templateName,
        status: "failed",
      });
    }
  }
}

/**
 * Notifies every family sponsor linked to a client that a visit completed. Visit/checkin
 * status is structural data a linked sponsor already sees without a consent grant (Domain 4
 * RLS), so no consent check gates this.
 */
export async function notifyVisitComplete(supabase: SupabaseClient<Database>, clientId: string) {
  const { data: sponsors } = await supabase.from("family_sponsor").select("user_id").eq("client_id", clientId);

  if (!sponsors || sponsors.length === 0) {
    return;
  }

  const { data: sponsorUsers } = await supabase
    .from("user")
    .select("id, phone")
    .in(
      "id",
      sponsors.map((sponsor) => sponsor.user_id),
    );

  await notifyRecipients(supabase, sponsorUsers ?? [], WHATSAPP_TEMPLATES.visitComplete);
}

/**
 * Notifies every billing-responsible sponsor for a client — deliberately narrower than
 * notifyVisitComplete's "every linked sponsor": invoice/payment visibility is gated the same
 * way in RLS (authority_grant, authority_type='billing_responsible'), not just family_sponsor
 * linkage.
 */
async function billingResponsibleSponsorUsers(supabase: SupabaseClient<Database>, clientId: string) {
  const { data: relationships } = await supabase
    .from("authority_grant")
    .select("sponsor_id")
    .eq("client_id", clientId)
    .eq("authority_type", "billing_responsible")
    .eq("status", "active");

  const sponsorIds = (relationships ?? []).map((r) => r.sponsor_id);
  if (sponsorIds.length === 0) return [];

  const { data: sponsors } = await supabase.from("family_sponsor").select("user_id").in("id", sponsorIds);
  const userIds = (sponsors ?? []).map((s) => s.user_id);
  if (userIds.length === 0) return [];

  const { data: users } = await supabase.from("user").select("id, phone").in("id", userIds);
  return users ?? [];
}

export async function notifyInvoiceReady(supabase: SupabaseClient<Database>, clientId: string) {
  const recipients = await billingResponsibleSponsorUsers(supabase, clientId);
  await notifyRecipients(supabase, recipients, WHATSAPP_TEMPLATES.invoiceReady);
}

export async function notifyPaymentReceived(supabase: SupabaseClient<Database>, clientId: string) {
  const recipients = await billingResponsibleSponsorUsers(supabase, clientId);
  await notifyRecipients(supabase, recipients, WHATSAPP_TEMPLATES.paymentReceived);
}

/**
 * Notifies staff that an escalation opened: every coordinator always, plus every clinical
 * director for critical severity — matching CLAUDE.md's safeguarding-routing rule that
 * critical/safeguarding matters reach the clinical director, not just whoever's on shift.
 */
export async function notifyEscalationOpened(supabase: SupabaseClient<Database>, severity: string) {
  const roleSlugs = severity === "critical" ? ["coordinator", "clinical_director"] : ["coordinator"];

  const { data: roles } = await supabase.from("role").select("id").in("slug", roleSlugs);

  if (!roles || roles.length === 0) {
    return;
  }

  const { data: staffUsers } = await supabase
    .from("user")
    .select("id, phone")
    .in(
      "role_id",
      roles.map((role) => role.id),
    );

  await notifyRecipients(supabase, staffUsers ?? [], WHATSAPP_TEMPLATES.escalationAlert);
}
