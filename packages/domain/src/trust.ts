/** Domain 5 — Trust, Rating & Feedback. Two-sided rating; see docs/domain-model.md Part 3.3. */

export interface VisitRating {
  id: string;
  visitId: string;
  raterUserId: string;
  ratedProviderId: string;
  score: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
}

export interface ServiceRating {
  id: string;
  clientId: string;
  score: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
}

export interface LiveVisitTracking {
  id: string;
  visitId: string;
  status: "en_route" | "arrived" | "in_progress" | "completed";
  shareableLinkToken: string;
}

export interface ProviderQualityScore {
  providerId: string;
  rollingAverage: number;
  ratingCount: number;
}

export interface Complaint {
  id: string;
  clientId: string;
  providerId: string | null;
  description: string;
  status: "open" | "investigating" | "resolved";
  raisedAt: string;
}

export interface SafeguardingCase {
  id: string;
  clientId: string;
  providerId: string | null;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved";
  raisedAt: string;
}
