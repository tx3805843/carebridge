import { PageHeader } from "@carebridge/ui";
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
 * Staff retention and referral rate (`supabase/migrations/20260810040000_provider_employment_client_referral.sql`
 * added the two fields these need): retention here is a point-in-time headcount ratio
 * (currently-active ÷ ever-onboarded), not a period-over-period churn rate — consistent with
 * every other metric on this page being all-time rather than date-ranged. Referral rate is
 * the fraction of clients whose recorded referral_source is specifically
 * 'existing_family_referral' (the metric this exit criterion actually means — organic growth
 * from families already using CareBridge), out of clients with any referral_source recorded
 * at all (referral_source is optional at onboarding, so unrecorded clients are excluded from
 * the denominator rather than counted as "not a referral").
 */
export default async function DashboardPage() {

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [
    { count: totalDueVisits },
    { count: completedVisits },
    { count: incidentCount },
    { data: activeSubscriptions },
    { data: providerStatuses },
    { data: clientReferralSources },
  ] = await Promise.all([
    supabase.from("visit").select("id", { count: "exact", head: true }).lt("scheduled_end", nowIso),
    supabase
      .from("visit")
      .select("id", { count: "exact", head: true })
      .lt("scheduled_end", nowIso)
      .eq("status", "completed"),
    supabase.from("incident_report").select("id", { count: "exact", head: true }),
    supabase.from("subscription").select("currency, amount").eq("status", "active"),
    supabase.from("provider").select("employment_status"),
    supabase.from("client").select("referral_source"),
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

  const totalProviders = providerStatuses?.length ?? 0;
  const activeProviders = (providerStatuses ?? []).filter((p) => p.employment_status === "active").length;
  const retentionRate = totalProviders > 0 ? (activeProviders / totalProviders) * 100 : null;

  const recordedReferrals = (clientReferralSources ?? []).filter((c) => c.referral_source !== null);
  const familyReferrals = recordedReferrals.filter((c) => c.referral_source === "existing_family_referral").length;
  const referralRate = recordedReferrals.length > 0 ? (familyReferrals / recordedReferrals.length) * 100 : null;

  return (
    <>
    <PageHeader title="Dashboard" description="All-time metrics — no date range yet, pilot scale doesn't need it." />

    <div className="grid w-full max-w-3xl grid-cols-2 gap-4">
      <div className="rounded-md border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">Visit completion rate</p>
        <p className="text-2xl font-semibold">
          {completionRate === null ? "—" : `${completionRate.toFixed(1)}%`}
        </p>
        <p className="text-xs text-muted-foreground">{completed} of {due} due visits</p>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">Late / missed-visit rate</p>
        <p className="text-2xl font-semibold">
          {lateOrMissedRate === null ? "—" : `${lateOrMissedRate.toFixed(1)}%`}
        </p>
        <p className="text-xs text-muted-foreground">{due - completed} of {due} due visits</p>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">Incident rate</p>
        <p className="text-2xl font-semibold">
          {incidentRatePer100Visits === null ? "—" : `${incidentRatePer100Visits.toFixed(1)} / 100 visits`}
        </p>
        <p className="text-xs text-muted-foreground">{incidentCount ?? 0} incident report(s) logged</p>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
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

      <div className="rounded-md border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">Staff retention</p>
        <p className="text-2xl font-semibold">{retentionRate === null ? "—" : `${retentionRate.toFixed(1)}%`}</p>
        <p className="text-xs text-muted-foreground">{activeProviders} of {totalProviders} providers active</p>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">Referral rate</p>
        <p className="text-2xl font-semibold">{referralRate === null ? "—" : `${referralRate.toFixed(1)}%`}</p>
        <p className="text-xs text-muted-foreground">
          {familyReferrals} of {recordedReferrals.length} clients with a recorded source
        </p>
      </div>
    </div>
    </>
  );
}
