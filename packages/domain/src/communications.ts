/** Domain 7 — Communications & Alerts. Escalation is first-class, not a notification subtype. */

export interface Notification {
  id: string;
  userId: string;
  channel: "whatsapp" | "sms" | "push" | "email";
  templateId: string;
  sentAt: string | null;
}

export interface WhatsappMessageLog {
  id: string;
  toPhone: string;
  templateName: string;
  status: "queued" | "sent" | "delivered" | "read" | "failed";
  waMessageId: string | null;
  sentAt: string;
}

export type EscalationSeverity = "low" | "medium" | "high" | "critical";

export interface Escalation {
  id: string;
  visitId: string | null;
  clientId: string;
  severity: EscalationSeverity;
  triggeredByRuleId: string | null;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: string;
  severity: EscalationSeverity;
  active: boolean;
}
