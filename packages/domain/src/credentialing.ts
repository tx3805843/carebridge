/** Domain 3 — Provider & Credentialing. See docs/domain-model.md Part 3 for the trust-card/credential rules. */

export type VerificationStatus = "unverified" | "pending" | "verified" | "expired" | "rejected";

export interface Provider {
  id: string;
  userId: string;
  role: "nurse" | "caregiver";
  yearsExperience: number;
  photoUrl: string | null;
  verifiedProfileId: string | null;
}

/** Polymorphic credential record — one subsystem for NMC PIN, police report, training, etc. Do not fork per document type. */
export interface Credential {
  id: string;
  providerId: string;
  credentialTypeId: string;
  issuingAuthority: string;
  status: VerificationStatus;
  expiryDate: string | null;
  evidenceDocumentRef: string | null;
}

export interface CredentialVerificationEvent {
  id: string;
  credentialId: string;
  performedBy: string;
  outcome: VerificationStatus;
  notes: string | null;
  occurredAt: string;
}

export interface IdentityVerification {
  id: string;
  providerId: string;
  vendor: "smile_id" | "youverify";
  status: VerificationStatus;
  verifiedAt: string | null;
}

export interface BackgroundCheck {
  id: string;
  providerId: string;
  status: VerificationStatus;
  documentRef: string;
  expiresAt: string | null;
}

export interface TrainingRecord {
  id: string;
  providerId: string;
  title: string;
  cpdPoints: number;
  completedAt: string;
}

export interface VerifiedProfile {
  id: string;
  providerId: string;
  idVerified: boolean;
  nmcLicensed: boolean;
  backgroundChecked: boolean;
  trainingCurrent: boolean;
}
