/** Domain 4 — Scheduling & Visit Ops. Visit is the atomic unit of trust; field-app writes offline-first via PowerSync. */

export interface Zone {
  id: string;
  name: string;
}

export interface Roster {
  id: string;
  providerId: string;
  zoneId: string;
  weekStarting: string;
}

export type VisitStatus = "scheduled" | "en_route" | "in_progress" | "completed" | "missed" | "cancelled";

export interface Visit {
  id: string;
  clientId: string;
  providerId: string;
  carePlanId: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: VisitStatus;
}

export interface VisitCheckin {
  id: string;
  visitId: string;
  event: "en_route" | "arrived" | "departed";
  occurredAt: string;
  /** Purged after visit closes — see location-privacy note in docs/domain-model.md */
  geoZoneOnly: string | null;
}

export interface Observation {
  id: string;
  visitId: string;
  type: string;
  value: string;
  recordedAt: string;
}

export interface Task {
  id: string;
  visitId: string;
  description: string;
  completed: boolean;
}
