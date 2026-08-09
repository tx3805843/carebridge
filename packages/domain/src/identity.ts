/** Domain 1 — Identity & Access. Placeholder shapes; superseded by `supabase gen types` once schema lands. */

export type Role = "coordinator" | "clinical_director" | "nurse" | "caregiver" | "family_sponsor" | "admin";

export interface User {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  phone: string;
  createdAt: string;
}

export interface FamilySponsor {
  id: string;
  userId: string;
  clientId: string;
  relationship: string;
}

export interface ClientRelationship {
  id: string;
  clientId: string;
  sponsorId: string;
  isDecisionMaker: boolean;
  isBillingResponsible: boolean;
}

export type ConsentScope = "clinical_detail" | "billing" | "location_tracking" | "photos";

export interface ConsentGrant {
  id: string;
  clientId: string;
  granteeUserId: string;
  scope: ConsentScope;
  grantedAt: string;
  revokedAt: string | null;
}
