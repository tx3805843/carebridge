const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Accra",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Africa/Accra",
});

// CareBridge operates on Ghana time only (Africa/Accra, UTC+0 year-round, no DST) — every
// operator-facing date/time uses this pair rather than the server/browser's default locale,
// per the UX review's "make dates unambiguous" rule (e.g. "10 Aug 2026", explicit Accra time).
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATE_FORMATTER.format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${DATE_TIME_FORMATTER.format(new Date(iso))} Accra time (GMT)`;
}

// `subscription.plan_code` is free text (e.g. "standard_weekly_care") entered by staff at
// subscription creation — there's no plan registry yet (that's Increment D4, a real product
// catalog). This only stops the raw snake_case from leaking into operator-facing copy; it does
// not validate or canonicalize plan codes.
export function formatPlanName(planCode: string | null | undefined): string {
  if (!planCode) return "—";
  return planCode
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
