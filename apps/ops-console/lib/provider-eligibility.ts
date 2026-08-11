// Pure logic shared by app/visits/new/page.tsx (precomputes eligibility for every
// client×provider pair) and app/visits/new/actions.ts (re-derives it for the one
// submitted pair before inserting a visit) — kept in one place so the UI's blocked-option
// wording and the server's rejection message can never drift apart.

export interface RosterAssignment {
  providerId: string;
  zoneId: string;
  weekStarting: string; // ISO date string (YYYY-MM-DD) — lexically sortable
}

// A provider's "current" zone is their single most-recent roster row by week_starting,
// across all zones they've ever been assigned to — not resolved against a specific visit
// date. roster.week_starting is a free-form date with no week-boundary normalization
// anywhere in this app, so there's no existing concept of "the roster as it will stand on
// a future date" to check against; this matches how /roster itself already presents
// "current" (the latest row, full stop). Returns null if the provider has no roster row at
// all.
export function getCurrentZoneId(providerId: string, assignments: RosterAssignment[]): string | null {
  const rows = assignments.filter((row) => row.providerId === providerId);

  if (rows.length === 0) {
    return null;
  }

  return rows.reduce((latest, row) => (row.weekStarting > latest.weekStarting ? row : latest)).zoneId;
}

export interface ProviderEligibilityProfile {
  providerId: string;
  isNurse: boolean;
  employmentStatus: string;
  nmcLicensed: boolean;
  currentZone: { id: string; name: string } | null;
}

// Returns every reason this provider is blocked from a visit against a client in
// targetZoneId — empty array means eligible. A provider can fail more than one check at
// once; all applicable reasons are returned, not just the first.
export function getBlockedReasons(profile: ProviderEligibilityProfile, targetZoneId: string): string[] {
  const reasons: string[] = [];

  // NMC PIN/AIN licensing only applies to nurses — caregivers have no equivalent statutory
  // credential (CLAUDE.md, matches the existing roster/actions.ts#addRosterAssignment guard).
  if (profile.isNurse && !profile.nmcLicensed) {
    reasons.push("NMC PIN/AIN not licensed");
  }

  if (profile.employmentStatus !== "active") {
    reasons.push(profile.employmentStatus === "on_leave" ? "on leave" : "no longer active (departed)");
  }

  if (profile.currentZone?.id !== targetZoneId) {
    reasons.push(profile.currentZone ? `rostered to ${profile.currentZone.name}` : "not yet rostered to any zone");
  }

  return reasons;
}
