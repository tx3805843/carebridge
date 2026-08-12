// authority_grant.authority_type values this page manages — matches the check constraint in
// supabase/migrations/20260810070000_family_authority_grants.sql exactly.
export const AUTHORITY_TYPES = [
  { value: "decision_maker", label: "Decision-maker authority" },
  { value: "billing_responsible", label: "Payer authority" },
  { value: "escort", label: "Escort authority" },
] as const;

// consent_grant.scope values this page manages. 'billing' and 'location_tracking' are not
// managed here — 'billing' access is now authority_grant-driven (see ADR-0005),
// 'location_tracking' has no UI anywhere yet and is out of this increment's scope.
export const CONSENT_SCOPES = [
  { value: "clinical_detail", label: "Health-update authority" },
  { value: "photos", label: "Photography & document consent" },
] as const;

export type AuthorityTypeValue = (typeof AUTHORITY_TYPES)[number]["value"];
export type ConsentScopeValue = (typeof CONSENT_SCOPES)[number]["value"];
