// Structured outcomes for escalation resolution — the UX review's P0 fix for the exception
// queue, replacing a resolution that was closeable with an empty note. Set reflects what
// actually closes an operational exception, not a generic "resolved"/"other" pair.
export const OUTCOME_CATEGORIES = [
  { value: "confirmed_safe", label: "Confirmed client safe" },
  { value: "escalated_to_clinical_director", label: "Escalated to Clinical Director" },
  { value: "family_notified", label: "Family notified" },
  { value: "care_plan_updated", label: "Care plan updated" },
  { value: "referred_external", label: "Referred to external service" },
  { value: "false_alarm", label: "False alarm" },
  { value: "other", label: "Other (see note)" },
] as const;

export type OutcomeCategory = (typeof OUTCOME_CATEGORIES)[number]["value"];

export const OUTCOME_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOME_CATEGORIES.map((category) => [category.value, category.label]),
);

// Per CLAUDE.md ("safeguarding complaints... routed to the clinical director") and the review's
// mockup ("Clinical Director required" on the critical case) — a critical escalation cannot be
// closed by just any staff member, only someone with clinical authority or admin override.
export const CRITICAL_RESOLVER_ROLE_SLUGS = ["clinical_director", "admin"];

// Response targets per severity, in minutes — the review's "show a response target" rule.
// Computed at render time from `created_at`; there's no SLA-clock schema, so this is a fixed
// operational policy, not a stored/configurable value.
export const RESPONSE_TARGET_MINUTES: Record<string, number> = {
  critical: 15,
  high: 60,
  medium: 240,
  low: 1440,
};

export const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};
