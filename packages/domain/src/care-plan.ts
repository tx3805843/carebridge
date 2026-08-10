/** Domain 2 — Client & Care Plan. Generated from live schema (see generated.ts) — no hand-written placeholders remain. */
import type { Database } from "./generated";

export type Client = Database["public"]["Tables"]["client"]["Row"];
export type ClientInsert = Database["public"]["Tables"]["client"]["Insert"];
export type CarePlan = Database["public"]["Tables"]["care_plan"]["Row"];
export type CarePlanInsert = Database["public"]["Tables"]["care_plan"]["Insert"];
export type EmergencyContact = Database["public"]["Tables"]["emergency_contact"]["Row"];
export type EmergencyContactInsert = Database["public"]["Tables"]["emergency_contact"]["Insert"];
export type DecisionMakerHierarchy = Database["public"]["Tables"]["decision_maker_hierarchy"]["Row"];
export type DecisionMakerHierarchyInsert = Database["public"]["Tables"]["decision_maker_hierarchy"]["Insert"];
