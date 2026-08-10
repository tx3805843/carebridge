/** Domain 1 — Identity & Access. Generated from live schema (see generated.ts) — no hand-written placeholders remain. */
import type { Database } from "./generated";

export type Role = Database["public"]["Tables"]["role"]["Row"];
export type User = Database["public"]["Tables"]["user"]["Row"];
export type FamilySponsor = Database["public"]["Tables"]["family_sponsor"]["Row"];
export type FamilySponsorInsert = Database["public"]["Tables"]["family_sponsor"]["Insert"];
export type ClientRelationship = Database["public"]["Tables"]["client_relationship"]["Row"];
export type ClientRelationshipInsert = Database["public"]["Tables"]["client_relationship"]["Insert"];
export type ConsentGrant = Database["public"]["Tables"]["consent_grant"]["Row"];
export type ConsentGrantInsert = Database["public"]["Tables"]["consent_grant"]["Insert"];
