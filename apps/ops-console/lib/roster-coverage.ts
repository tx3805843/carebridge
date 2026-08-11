// Pure logic for the roster weekly coverage board (Increment D3): zone-grouped coverage gaps
// and per-provider visit-overlap detection. Reused by app/roster/coverage/page.tsx. No
// schema change — all inputs come from already-fetched roster/visit rows for one specific
// week.

export interface ZoneCoverageInput {
  zoneId: string;
  providerId: string;
}

export interface ZoneCoverage {
  zoneId: string;
  providerIds: string[];
  isGap: boolean;
}

// Groups a single week's roster rows by zone, returning every zone — including ones with
// zero rostered providers, which is the gap this board exists to surface — alongside the
// provider ids rostered there.
export function computeZoneCoverage(zones: { id: string }[], rosterRows: ZoneCoverageInput[]): ZoneCoverage[] {
  const providerIdsByZoneId = new Map<string, string[]>();
  for (const row of rosterRows) {
    const list = providerIdsByZoneId.get(row.zoneId) ?? [];
    list.push(row.providerId);
    providerIdsByZoneId.set(row.zoneId, list);
  }

  return zones.map((zone) => {
    const providerIds = providerIdsByZoneId.get(zone.id) ?? [];
    return { zoneId: zone.id, providerIds, isGap: providerIds.length === 0 };
  });
}

export interface VisitWindow {
  start: string; // ISO timestamptz
  end: string; // ISO timestamptz
}

// Counts pairs of visits whose time ranges overlap — same overlap definition
// app/visits/new/visit-form.tsx already uses for its advisory double-booking warning
// (`start < otherEnd && end > otherStart`), reimplemented here for an all-pairs-in-a-set
// check rather than that module's one-new-visit-vs-existing shape. 0 = no conflict. Callers
// are expected to pre-filter to non-terminal visits (scheduled/en_route/in_progress) — the
// same status filter app/visits/new/page.tsx already uses for the identical conflict
// concept — since a completed or cancelled visit's time slot can't meaningfully double-book
// anything.
export function countOverlappingPairs(visits: VisitWindow[]): number {
  let count = 0;
  for (let i = 0; i < visits.length; i++) {
    const a = visits[i];
    if (!a) continue;
    for (let j = i + 1; j < visits.length; j++) {
      const b = visits[j];
      if (!b) continue;
      if (a.start < b.end && a.end > b.start) {
        count++;
      }
    }
  }
  return count;
}

export const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  on_leave: "On leave",
  departed: "Departed",
};

export const EMPLOYMENT_STATUS_VARIANT: Record<string, "success" | "warning" | "neutral"> = {
  active: "success",
  on_leave: "warning",
  departed: "neutral",
};
