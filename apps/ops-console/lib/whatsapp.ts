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
 * Notifies every family sponsor linked to a client that a visit completed. Visit/checkin
 * status is structural data a linked sponsor already sees without a consent grant (Domain 4
 * RLS), so no consent check gates this. Degrades to a logged, unsent `whatsapp_message_log`
 * row rather than throwing when WhatsApp isn't configured (Meta template approval is still
 * pending) or a sponsor has no phone on file — never blocks the caller's visit-logging flow.
 */
export async function notifyVisitComplete(
  supabase: SupabaseClient<Database>,
  clientId: string,
) {
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

  const client = getWhatsappClient();

  for (const sponsor of sponsorUsers ?? []) {
    const { data: notification } = await supabase
      .from("notification")
      .insert({ user_id: sponsor.id, channel: "whatsapp", template_id: WHATSAPP_TEMPLATES.visitComplete })
      .select("id")
      .single();

    if (!notification) {
      continue;
    }

    if (!client || !sponsor.phone) {
      await supabase.from("whatsapp_message_log").insert({
        to_phone: sponsor.phone ?? "unknown",
        template_name: WHATSAPP_TEMPLATES.visitComplete,
        status: "failed",
      });
      continue;
    }

    try {
      const { messageId } = await client.sendTemplateMessage({
        to: sponsor.phone,
        templateName: WHATSAPP_TEMPLATES.visitComplete,
      });
      await supabase.from("whatsapp_message_log").insert({
        to_phone: sponsor.phone,
        template_name: WHATSAPP_TEMPLATES.visitComplete,
        status: "sent",
        wa_message_id: messageId,
      });
      await supabase.from("notification").update({ sent_at: new Date().toISOString() }).eq("id", notification.id);
    } catch {
      await supabase.from("whatsapp_message_log").insert({
        to_phone: sponsor.phone,
        template_name: WHATSAPP_TEMPLATES.visitComplete,
        status: "failed",
      });
    }
  }
}
