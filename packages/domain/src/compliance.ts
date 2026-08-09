/** Domain 9 — Compliance & Audit. Append-only audit log spans every domain. */

export interface ConsentRecord {
  id: string;
  clientId: string;
  documentRef: string;
  signedAt: string;
}

export interface DpcRegistration {
  id: string;
  registrationNumber: string;
  status: "active" | "pending" | "lapsed";
  renewalDueAt: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
}

export interface IncidentReport {
  id: string;
  clientId: string | null;
  providerId: string | null;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  reportedAt: string;
}

export interface DataRetentionPolicy {
  id: string;
  entityType: string;
  retentionDays: number;
}
