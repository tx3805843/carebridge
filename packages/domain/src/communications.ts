/** Domain 7 — Communications & Alerts. Generated from live schema (see generated.ts) — no hand-written placeholders remain. */
import type { Database } from "./generated";

export type Notification = Database["public"]["Tables"]["notification"]["Row"];
export type NotificationInsert = Database["public"]["Tables"]["notification"]["Insert"];
export type WhatsappMessageLog = Database["public"]["Tables"]["whatsapp_message_log"]["Row"];
export type WhatsappMessageLogInsert = Database["public"]["Tables"]["whatsapp_message_log"]["Insert"];
export type Escalation = Database["public"]["Tables"]["escalation"]["Row"];
export type EscalationInsert = Database["public"]["Tables"]["escalation"]["Insert"];
export type AlertRule = Database["public"]["Tables"]["alert_rule"]["Row"];
export type AlertRuleInsert = Database["public"]["Tables"]["alert_rule"]["Insert"];
