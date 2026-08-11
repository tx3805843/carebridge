// Pure logic deriving each provider's per-signal verification badge state from the
// underlying evidence tables (identity_verification, credential, background_check,
// training_record) rather than trusting verified_profile's flat booleans — that summary is
// a separate cron/manually-maintained rollup (see D2, which governs making it trustworthy
// and read-only). Reused by app/providers/page.tsx.

export type VerificationState = "verified" | "missing" | "not_applicable" | "expiring";

// Matches credential-expiry-cron's own EXPIRY_WARNING_DAYS (supabase/functions/
// credential-expiry-cron/index.ts) — kept as a separate constant, not imported, since the
// cron runs in a separate Deno edge function, not this Next.js app.
export const EXPIRY_WARNING_DAYS = 30;

function isWithinWarningWindow(dateIso: string, todayIso: string, warningCutoffIso: string): boolean {
  return dateIso >= todayIso && dateIso <= warningCutoffIso;
}

function latestByCreatedAt<T extends { createdAt: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) => (row.createdAt > latest.createdAt ? row : latest));
}

export interface IdentityVerificationEvidence {
  status: string;
  createdAt: string;
}

// ID verification has no expiry concept anywhere in the schema — Verified or Missing only.
export function getIdStatus(rows: IdentityVerificationEvidence[]): VerificationState {
  const latest = latestByCreatedAt(rows);
  return latest?.status === "verified" ? "verified" : "missing";
}

export interface NmcCredentialEvidence {
  status: string;
  expiryDate: string | null;
  createdAt: string;
}

// NMC PIN/AIN only applies to nurses (CLAUDE.md — caregivers have no equivalent statutory
// credential). A credential past its expiry_date reads as Missing, not Expiring — matching
// credential-expiry-cron's own behavior (past-due credentials auto-flip to status='expired',
// at which point verified_profile.nmc_licensed goes false; this mirrors that end state even
// before the cron has run, since a lexical expiry_date < todayIso comparison doesn't need
// the cron to already have acted).
export function getNmcStatus(
  isNurse: boolean,
  rows: NmcCredentialEvidence[],
  todayIso: string,
  warningCutoffIso: string,
): VerificationState {
  if (!isNurse) return "not_applicable";

  const latest = latestByCreatedAt(rows);
  if (!latest || latest.status !== "verified") return "missing";
  if (!latest.expiryDate) return "verified";
  if (latest.expiryDate < todayIso) return "missing";
  return isWithinWarningWindow(latest.expiryDate, todayIso, warningCutoffIso) ? "expiring" : "verified";
}

export interface BackgroundCheckEvidence {
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

// Same expiry shape as NMC, but background_check isn't cron-recomputed today — reading
// straight from the evidence table here (rather than verified_profile.background_checked)
// surfaces staleness the manually-toggled flag could otherwise hide.
export function getBackgroundStatus(
  rows: BackgroundCheckEvidence[],
  todayIso: string,
  warningCutoffIso: string,
): VerificationState {
  const latest = latestByCreatedAt(rows);
  if (!latest || latest.status !== "verified") return "missing";
  if (!latest.expiresAt) return "verified";
  if (latest.expiresAt < todayIso) return "missing";
  return isWithinWarningWindow(latest.expiresAt, todayIso, warningCutoffIso) ? "expiring" : "verified";
}

export interface TrainingRecordEvidence {
  createdAt: string;
}

// training_record has no status or expiry field — any record at all counts as Verified.
export function getTrainingStatus(rows: TrainingRecordEvidence[]): VerificationState {
  return rows.length > 0 ? "verified" : "missing";
}

export interface ProviderVerificationBadges {
  id: VerificationState;
  nmc: VerificationState;
  background: VerificationState;
  training: VerificationState;
}

export function getProviderVerificationBadges(input: {
  isNurse: boolean;
  identityVerifications: IdentityVerificationEvidence[];
  nmcCredentials: NmcCredentialEvidence[];
  backgroundChecks: BackgroundCheckEvidence[];
  trainingRecords: TrainingRecordEvidence[];
  todayIso: string;
  warningCutoffIso: string;
}): ProviderVerificationBadges {
  return {
    id: getIdStatus(input.identityVerifications),
    nmc: getNmcStatus(input.isNurse, input.nmcCredentials, input.todayIso, input.warningCutoffIso),
    background: getBackgroundStatus(input.backgroundChecks, input.todayIso, input.warningCutoffIso),
    training: getTrainingStatus(input.trainingRecords),
  };
}
