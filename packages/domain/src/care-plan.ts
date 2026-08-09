/** Domain 2 — Client & Care Plan. */

export interface Client {
  id: string;
  fullName: string;
  dateOfBirth: string;
  address: string;
  zoneId: string;
}

export interface CarePlan {
  id: string;
  clientId: string;
  summary: string;
  createdBy: string;
  effectiveFrom: string;
  reviewDueAt: string;
}

export interface EmergencyContact {
  id: string;
  clientId: string;
  fullName: string;
  phone: string;
  priority: number;
}

export interface DecisionMakerHierarchy {
  id: string;
  clientId: string;
  sponsorId: string;
  priority: number;
}
