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

// Short relative age for triage lists ("18m ago") — the absolute Accra-time formatters above
// stay the source of truth in detail views; this is only for scanning a queue at a glance.
export function formatRelativeAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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

// One Intl.NumberFormat instance per currency, cached — construction is the expensive part
// and a billing page can render dozens of amounts in the same currency in one request.
// currencyDisplay: "code" renders "GHS 1,200.00" rather than a symbol — avoids $ ambiguity
// across USD/GBP/EUR and matches this app's existing explicit-over-implicit formatting
// stance (same reasoning formatDateTime spells out "Accra time (GMT)" rather than relying on
// an implicit timezone).
const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();

export function formatCurrency(amount: number, currency: string): string {
  let formatter = CURRENCY_FORMATTERS.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "code" });
    CURRENCY_FORMATTERS.set(currency, formatter);
  }
  return formatter.format(amount);
}
