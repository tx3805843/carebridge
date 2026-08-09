/** Domain 10 — Analytics & Quality. */

export interface KpiSnapshot {
  id: string;
  metric: string;
  value: number;
  capturedAt: string;
}

export interface ZonePerformance {
  zoneId: string;
  visitCompletionRate: number;
  averageRating: number;
  periodStart: string;
  periodEnd: string;
}

export interface RetentionMetric {
  clientId: string;
  monthsActive: number;
  churnRiskScore: number;
}
