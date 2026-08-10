import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Phase 1 exit criterion: "Visit completion rate, late/missed-visit rate, incident rate,
 * staff retention, MRR, and referral rate are all measurable from the console — no
 * spreadsheet required." All-live-query, no new schema: at pilot scale (10-20 families) a
 * pre-aggregated snapshot table (Domain 10 — kpi_snapshot/zone_performance/retention_metric)
 * is unwarranted complexity for what's a handful of COUNT/SUM queries; that table set is
 * explicitly Phase 3 scope (roadmap's own "Quality dashboard" epic line), not Phase 1's.
 * No date-range picker either — pilot scale doesn't need period-over-period trending yet;
 * every metric here is all-time.
 *
 * Two of the six named metrics have no underlying data model at all right now: staff
 * retention needs an employment-status/departure field on `provider` (doesn't exist —
 * provider rows are never "closed out", so there's no churn signal to compute from), and
 * referral rate needs a referral-source field on client onboarding (doesn't exist either,
 * and isn't the Domain 6 `referral` table, which is Phase 3 care-coordination referrals to
 * external providers, an unrelated concept despite the name collision). Shown as an explicit
 * "not yet trackable" note rather than a fabricated number — see the two new open items
 * logged in the roadmap alongside this story.
 */
export default async function DashboardPage() {
  await requireStaffUser();

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [{ count: totalDueVisits }, { count: completedVisits }, { count: incidentCount }, { data: activeSubscriptions }] =
    await Promise.all([
      supabase.from("visit").select("id", { count: "exact", head: true }).lt("scheduled_end", nowIso),
      supabase
        .from("visit")
        .select("id", { count: "exact", head: true })
        .lt("scheduled_end", nowIso)
        .eq("status", "completed"),
      supabase.from("incident_report").select("id", { count: "exact", head: true }),
      supabase.from("subscription").select("currency, amount").eq("status", "active"),
    ]);

  const due = totalDueVisits ?? 0;
  const completed = completedVisits ?? 0;
  const completionRate = due > 0 ? (completed / due) * 100 : null;
  const lateOrMissedRate = due > 0 ? ((due - completed) / due) * 100 : null;
  const incidentRatePer100Visits = due > 0 ? ((incidentCount ?? 0) / due) * 100 : null;

  const mrrByCurrency = new Map<string, number>();
  for (const subscription of activeSubscriptions ?? []) {
    mrrByCurrency.set(subscription.currency, (mrrByCurrency.get(subscription.currency) ?? 0) + subscription.amount);
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-24">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid w-full max-w-3xl grid-cols-2 gap-4">
        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">Visit completion rate</p>
          <p className="text-2xl font-semibold">
            {completionRate === null ? "—" : `${completionRate.toFixed(1)}%`}
          </p>
          <p className="text-xs text-muted-foreground">{completed} of {due} due visits</p>
        </div>

        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">Late / missed-visit rate</p>
          <p className="text-2xl font-semibold">
            {lateOrMissedRate === null ? "—" : `${lateOrMissedRate.toFixed(1)}%`}
          </p>
          <p className="text-xs text-muted-foreground">{due - completed} of {due} due visits</p>
        </div>

        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">Incident rate</p>
          <p className="text-2xl font-semibold">
            {incidentRatePer100Visits === null ? "—" : `${incidentRatePer100Visits.toFixed(1)} / 100 visits`}
          </p>
          <p className="text-xs text-muted-foreground">{incidentCount ?? 0} incident report(s) logged</p>
        </div>

        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">MRR (active subscriptions)</p>
          {mrrByCurrency.size === 0 ? (
            <p className="text-2xl font-semibold">—</p>
          ) : (
            <p className="text-2xl font-semibold">
              {[...mrrByCurrency.entries()].map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`).join(" + ")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">Shown per currency — no FX conversion applied</p>
        </div>

        <div className="rounded-md border border-border p-4 opacity-60">
          <p className="text-sm text-muted-foreground">Staff retention</p>
          <p className="text-lg font-medium">Not yet trackable</p>
          <p className="text-xs text-muted-foreground">No employment-status field on provider yet</p>
        </div>

        <div className="rounded-md border border-border p-4 opacity-60">
          <p className="text-sm text-muted-foreground">Referral rate</p>
          <p className="text-lg font-medium">Not yet trackable</p>
          <p className="text-xs text-muted-foreground">No referral-source field on client onboarding yet</p>
        </div>
      </div>
    </main>
  );
}
