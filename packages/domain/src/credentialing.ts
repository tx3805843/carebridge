/** Domain 3 — Provider & Credentialing. Generated from live schema (see generated.ts) — no hand-written placeholders remain. */
import type { Database } from "./generated";

export type CredentialType = Database["public"]["Tables"]["credential_type"]["Row"];
export type Provider = Database["public"]["Tables"]["provider"]["Row"];
export type ProviderInsert = Database["public"]["Tables"]["provider"]["Insert"];
export type VerificationStatus = Database["public"]["Tables"]["credential"]["Row"]["status"];
export type Credential = Database["public"]["Tables"]["credential"]["Row"];
export type CredentialInsert = Database["public"]["Tables"]["credential"]["Insert"];
export type CredentialVerificationEvent = Database["public"]["Tables"]["credential_verification_event"]["Row"];
export type CredentialVerificationEventInsert =
  Database["public"]["Tables"]["credential_verification_event"]["Insert"];
export type IdentityVerification = Database["public"]["Tables"]["identity_verification"]["Row"];
export type IdentityVerificationInsert = Database["public"]["Tables"]["identity_verification"]["Insert"];
export type BackgroundCheck = Database["public"]["Tables"]["background_check"]["Row"];
export type BackgroundCheckInsert = Database["public"]["Tables"]["background_check"]["Insert"];
export type TrainingRecord = Database["public"]["Tables"]["training_record"]["Row"];
export type TrainingRecordInsert = Database["public"]["Tables"]["training_record"]["Insert"];
export type VerifiedProfile = Database["public"]["Tables"]["verified_profile"]["Row"];
export type VerifiedProfileInsert = Database["public"]["Tables"]["verified_profile"]["Insert"];
