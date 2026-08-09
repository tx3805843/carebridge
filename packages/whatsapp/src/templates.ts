/**
 * Template name registry — must match the templates registered/approved in the
 * Meta Business Manager. Keep in sync manually; there is no schema-driven source of truth.
 */
export const WHATSAPP_TEMPLATES = {
  visitScheduledTrustCard: "visit_scheduled_trust_card",
  caregiverEnRoute: "caregiver_en_route",
  caregiverArrived: "caregiver_arrived",
  visitInProgress: "visit_in_progress",
  visitComplete: "visit_complete",
  ratingPrompt: "visit_rating_prompt",
  escalationAlert: "escalation_alert",
  invoiceReady: "invoice_ready",
  paymentReceived: "payment_received",
  credentialExpiringSoon: "credential_expiring_soon",
} as const;

export type WhatsappTemplateName = (typeof WHATSAPP_TEMPLATES)[keyof typeof WHATSAPP_TEMPLATES];
