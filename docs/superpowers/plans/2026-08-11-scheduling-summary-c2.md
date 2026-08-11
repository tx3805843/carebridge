# Scheduling Summary Richness (Increment C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/visits/new` shows a live scheduling summary (zone, current care plan, and any
provider double-booking conflict) as the coordinator fills in the form, and gates the actual
submit behind a `ConfirmSubmitButton` whose dialog restates the same information — reusing
existing components and idioms throughout, no schema change, no new server-side gate (the
conflict check is advisory, confirmed with the user).

**Architecture:** `page.tsx` extends its existing per-client/per-provider precompute (same
`Promise.all` + `Map`-join shape Increment C1 established) with two more plain-object props:
`careplanByClientId` and `visitsByProviderId`. `visit-form.tsx` converts its client/provider
selects from uncontrolled+key-remount to fully controlled state (removing C1's key-remount
workaround now that real state tracking exists for the summary panel anyway — a targeted
improvement, not scope creep, since the same state is needed either way), computes a live
conflict check client-side against the precomputed visit list, and swaps the plain "Schedule
visit" `<Button>` for a `ConfirmSubmitButton`. No changes to `actions.ts` — `scheduleVisit`'s
logic is untouched, per the design's explicit "advisory, no server gate" decision.

**Tech Stack:** Next.js App Router server component + client component, Supabase JS client,
plain TypeScript. No test runner exists for `ops-console` — verification is
`typecheck`/`lint` plus a real browser walkthrough, matching every prior increment.

**Spec:** `docs/superpowers/specs/2026-08-11-scheduling-summary-c2-design.md`

---

### Task 1: `page.tsx` — add care-plan and existing-visit data to the precompute

**Files:**
- Modify: `apps/ops-console/app/visits/new/page.tsx`

- [ ] **Step 1: Replace the whole file**

Current file (94 lines, from Increment C1) fetches 6 tables in parallel plus a conditional
7th (`providerUsers`) and builds `clientOptions`/`matrix`. Replace its full content with:

```tsx
import { PageHeader } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { getBlockedReasons, getCurrentZoneId, type ProviderEligibilityProfile } from "@/lib/provider-eligibility";
import { VisitForm } from "./visit-form";

export default async function NewVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; visitScheduled?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { error, visitScheduled } = await searchParams;

  const supabase = await createClient();

  const [
    { data: clients },
    { data: providers },
    { data: roles },
    { data: verifiedProfiles },
    { data: rosterRows },
    { data: zones },
    { data: carePlans },
    { data: existingVisits },
  ] = await Promise.all([
    supabase.from("client").select("id, full_name, zone_id").order("full_name"),
    supabase.from("provider").select("id, user_id, employment_status"),
    supabase.from("role").select("id, slug"),
    supabase.from("verified_profile").select("provider_id, nmc_licensed"),
    supabase.from("roster").select("provider_id, zone_id, week_starting"),
    supabase.from("zone").select("id, name"),
    supabase.from("care_plan").select("client_id, summary, effective_from"),
    supabase
      .from("visit")
      .select("provider_id, client_id, scheduled_start, scheduled_end")
      .in("status", ["scheduled", "en_route", "in_progress"]),
  ]);

  const providerUserIds = (providers ?? []).map((provider) => provider.user_id);
  const { data: providerUsers } =
    providerUserIds.length > 0
      ? await supabase.from("user").select("id, full_name, role_id").in("id", providerUserIds)
      : { data: [] };

  const providerUserById = new Map((providerUsers ?? []).map((user) => [user.id, user]));
  const roleSlugById = new Map((roles ?? []).map((role) => [role.id, role.slug]));
  const nmcLicensedByProviderId = new Map((verifiedProfiles ?? []).map((vp) => [vp.provider_id, vp.nmc_licensed]));
  const zoneNameById = new Map((zones ?? []).map((zone) => [zone.id, zone.name]));
  const clientLabelById = new Map((clients ?? []).map((client) => [client.id, client.full_name]));

  const rosterAssignments = (rosterRows ?? []).map((row) => ({
    providerId: row.provider_id,
    zoneId: row.zone_id,
    weekStarting: row.week_starting,
  }));

  const providerProfiles = (providers ?? []).map((provider) => {
    const user = providerUserById.get(provider.user_id);
    const roleSlug = user ? roleSlugById.get(user.role_id) : undefined;
    const currentZoneId = getCurrentZoneId(provider.id, rosterAssignments);
    const currentZoneName = currentZoneId ? zoneNameById.get(currentZoneId) : undefined;

    const profile: ProviderEligibilityProfile = {
      providerId: provider.id,
      isNurse: roleSlug === "nurse",
      employmentStatus: provider.employment_status,
      nmcLicensed: nmcLicensedByProviderId.get(provider.id) ?? false,
      currentZone: currentZoneId && currentZoneName ? { id: currentZoneId, name: currentZoneName } : null,
    };

    return { profile, label: user?.full_name ?? "Unnamed provider" };
  });

  const clientOptions = (clients ?? []).map((client) => ({ id: client.id, label: client.full_name }));

  const matrix: Record<
    string,
    { eligible: { id: string; label: string }[]; blocked: { id: string; label: string; reasons: string[] }[] }
  > = {};

  for (const client of clients ?? []) {
    const eligible: { id: string; label: string }[] = [];
    const blocked: { id: string; label: string; reasons: string[] }[] = [];

    for (const { profile, label } of providerProfiles) {
      const reasons = getBlockedReasons(profile, client.zone_id);

      if (reasons.length === 0) {
        eligible.push({ id: profile.providerId, label });
      } else {
        blocked.push({ id: profile.providerId, label, reasons });
      }
    }

    matrix[client.id] = { eligible, blocked };
  }

  const zoneNameByClientId: Record<string, string> = {};
  for (const client of clients ?? []) {
    zoneNameByClientId[client.id] = zoneNameById.get(client.zone_id) ?? "No zone";
  }

  const careplanByClientId: Record<string, { effectiveFrom: string; summary: string } | null> = {};
  for (const client of clients ?? []) {
    careplanByClientId[client.id] = null;
  }
  for (const carePlan of carePlans ?? []) {
    const current = careplanByClientId[carePlan.client_id];
    if (!current || carePlan.effective_from > current.effectiveFrom) {
      careplanByClientId[carePlan.client_id] = { effectiveFrom: carePlan.effective_from, summary: carePlan.summary };
    }
  }

  const visitsByProviderId: Record<string, { clientLabel: string; scheduledStart: string; scheduledEnd: string }[]> =
    {};
  for (const visit of existingVisits ?? []) {
    const entry = {
      clientLabel: clientLabelById.get(visit.client_id) ?? "Unknown client",
      scheduledStart: visit.scheduled_start,
      scheduledEnd: visit.scheduled_end,
    };
    (visitsByProviderId[visit.provider_id] ??= []).push(entry);
  }

  return (
    <AppShell user={staffUser}>
      <PageHeader title="Schedule a visit" />
      {visitScheduled ? <p className="mb-4 text-sm text-success">Visit scheduled.</p> : null}
      <VisitForm
        clients={clientOptions}
        matrix={matrix}
        zoneNameByClientId={zoneNameByClientId}
        careplanByClientId={careplanByClientId}
        visitsByProviderId={visitsByProviderId}
        error={error}
      />
    </AppShell>
  );
}
```

Note `careplanByClientId` is initialized to `null` for every client first, then overwritten
only for clients that actually have a care plan — this is what makes "No care plan yet" a
real, distinguishable state in `visit-form.tsx` rather than `undefined` silently meaning the
same thing as "still loading."

- [ ] **Step 2: Confirm it does not yet typecheck (`VisitForm`'s props haven't changed)**

Run: `pnpm --filter ops-console typecheck`
Expected: FAILS — `VisitForm` (Task 2, not done yet) still expects the old prop shape. This
is expected, same pattern as Increment C1's Task 2/3 split; do not fix it here.

- [ ] **Step 3: Commit**

```bash
git add apps/ops-console/app/visits/new/page.tsx
git commit -m "C2: add care-plan and existing-visit data to visits/new precompute"
```

---

### Task 2: `visit-form.tsx` — live summary panel, controlled fields, conflict check, confirm gate

**Files:**
- Modify: `apps/ops-console/app/visits/new/visit-form.tsx`

- [ ] **Step 1: Replace the whole file**

Current file (109 lines, from Increment C1) has an uncontrolled provider `<select>` reset via
`key={clientId}`, no state tracking for provider/times, and a plain `<Button type="submit">`.
Replace its full content with:

```tsx
"use client";

import { useState } from "react";
import { ConfirmSubmitButton } from "@carebridge/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { scheduleVisit } from "./actions";

interface Option {
  id: string;
  label: string;
}

interface BlockedOption extends Option {
  reasons: string[];
}

interface ClientEligibility {
  eligible: Option[];
  blocked: BlockedOption[];
}

interface CarePlanSummary {
  effectiveFrom: string;
  summary: string;
}

interface ExistingVisit {
  clientLabel: string;
  scheduledStart: string;
  scheduledEnd: string;
}

interface Snapshot {
  clientId: string;
  providerId: string;
  scheduledStart: string;
  scheduledEnd: string;
}

const EMPTY_SNAPSHOT: Snapshot = { clientId: "", providerId: "", scheduledStart: "", scheduledEnd: "" };

// Two half-open ranges [aStart, aEnd) and [bStart, bEnd) overlap iff aStart < bEnd && bStart < aEnd.
// Returns the first conflicting existing visit for this provider, or null if none (including
// while any of the four inputs needed to compute this are still empty/invalid).
function findConflict(
  providerId: string,
  scheduledStart: string,
  scheduledEnd: string,
  visitsByProviderId: Record<string, ExistingVisit[]>,
): ExistingVisit | null {
  if (!providerId || !scheduledStart || !scheduledEnd) {
    return null;
  }

  const newStart = new Date(scheduledStart).getTime();
  const newEnd = new Date(scheduledEnd).getTime();

  if (Number.isNaN(newStart) || Number.isNaN(newEnd) || newEnd <= newStart) {
    return null;
  }

  const existingVisits = visitsByProviderId[providerId] ?? [];

  return (
    existingVisits.find((visit) => {
      const existingStart = new Date(visit.scheduledStart).getTime();
      const existingEnd = new Date(visit.scheduledEnd).getTime();
      return existingStart < newEnd && newStart < existingEnd;
    }) ?? null
  );
}

export function VisitForm({
  clients,
  matrix,
  zoneNameByClientId,
  careplanByClientId,
  visitsByProviderId,
  error,
}: {
  clients: Option[];
  matrix: Record<string, ClientEligibility>;
  zoneNameByClientId: Record<string, string>;
  careplanByClientId: Record<string, CarePlanSummary | null>;
  visitsByProviderId: Record<string, ExistingVisit[]>;
  error?: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);

  const eligibility = matrix[snapshot.clientId];
  const zoneName = snapshot.clientId ? zoneNameByClientId[snapshot.clientId] : undefined;
  const carePlan = snapshot.clientId ? careplanByClientId[snapshot.clientId] : undefined;
  const conflict = findConflict(snapshot.providerId, snapshot.scheduledStart, snapshot.scheduledEnd, visitsByProviderId);

  const selectedClientLabel = clients.find((client) => client.id === snapshot.clientId)?.label ?? "";
  const selectedProviderLabel =
    eligibility?.eligible.find((provider) => provider.id === snapshot.providerId)?.label ?? "";

  const canSubmit = Boolean(
    snapshot.clientId && snapshot.providerId && snapshot.scheduledStart && snapshot.scheduledEnd,
  );

  return (
    <form action={scheduleVisit} className="flex w-full max-w-xl flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Client
        <select
          name="clientId"
          required
          value={snapshot.clientId}
          onChange={(event) =>
            setSnapshot((prev) => ({ ...prev, clientId: event.target.value, providerId: "" }))
          }
          className="rounded-md border border-border px-3 py-2"
        >
          <option value="" disabled>
            Select a client
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Provider
        <select
          name="providerId"
          required
          value={snapshot.providerId}
          onChange={(event) => setSnapshot((prev) => ({ ...prev, providerId: event.target.value }))}
          disabled={!eligibility}
          className="rounded-md border border-border px-3 py-2 disabled:cursor-not-allowed disabled:bg-muted"
        >
          <option value="" disabled>
            {eligibility ? "Select a provider" : "Select a client first"}
          </option>
          {eligibility ? (
            <>
              <optgroup label="Eligible">
                {eligibility.eligible.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Blocked">
                {eligibility.blocked.map((provider) => (
                  <option key={provider.id} value={provider.id} disabled>
                    {provider.label} — {provider.reasons.join("; ")}
                  </option>
                ))}
              </optgroup>
            </>
          ) : null}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Scheduled start
        <input
          type="datetime-local"
          name="scheduledStart"
          required
          value={snapshot.scheduledStart}
          onChange={(event) => setSnapshot((prev) => ({ ...prev, scheduledStart: event.target.value }))}
          className="rounded-md border border-border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Scheduled end
        <input
          type="datetime-local"
          name="scheduledEnd"
          required
          value={snapshot.scheduledEnd}
          onChange={(event) => setSnapshot((prev) => ({ ...prev, scheduledEnd: event.target.value }))}
          className="rounded-md border border-border px-3 py-2"
        />
      </label>

      {snapshot.clientId ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4 text-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scheduling summary</h2>
          <p>
            <span className="font-medium">Zone:</span> {zoneName ?? "No zone"}
          </p>
          <p>
            <span className="font-medium">Care plan:</span>{" "}
            {carePlan ? `effective ${formatDate(carePlan.effectiveFrom)}: ${carePlan.summary}` : "No care plan yet"}
          </p>
          {conflict ? (
            <p className="text-warning">
              Conflict: this provider already has a visit scheduled for {conflict.clientLabel} at{" "}
              {formatDateTime(conflict.scheduledStart)}–{formatDateTime(conflict.scheduledEnd)}.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-critical">{error}</p> : null}

      <ConfirmSubmitButton
        disabled={!canSubmit}
        confirmTitle="Schedule visit"
        confirmDescription={
          conflict ? (
            <>
              Schedule <strong>{selectedProviderLabel}</strong> for <strong>{selectedClientLabel}</strong>. This
              provider already has a visit scheduled for {conflict.clientLabel} at{" "}
              {formatDateTime(conflict.scheduledStart)}–{formatDateTime(conflict.scheduledEnd)} — schedule anyway?
            </>
          ) : (
            <>
              Schedule <strong>{selectedProviderLabel}</strong> for <strong>{selectedClientLabel}</strong>?
            </>
          )
        }
        confirmLabel="Schedule visit"
      >
        Schedule visit
      </ConfirmSubmitButton>
    </form>
  );
}
```

Notes on real changes from the C1 version, not arbitrary rewrites:

- **Client and provider `<select>`s are now fully controlled** (`value={snapshot.x}` +
  `onChange`) instead of C1's uncontrolled-with-`key={clientId}`-remount trick. The client
  select's `onChange` explicitly resets `providerId` to `""` in the same state update — this
  is what the old `key` remount used to achieve implicitly, but doing it explicitly avoids a
  real timing hazard: a form-level "read `FormData` on any change" approach (the pattern used
  by `client-form.tsx`'s onboarding wizard) would, if adopted here instead, read the
  provider select's *old* DOM value during the client-change event, one render tick before the
  key-based remount actually clears it — a stale-value bug in the same class already found and
  fixed twice in this app (`app/exceptions/page.tsx`'s `key={selectedEscalation.id}` fix, and
  C1's own `key={clientId}` fix). Explicit controlled state sidesteps the hazard entirely rather
  than reintroducing a variant of it.
- `formatDate`/`formatDateTime` from `@/lib/format` (Accra-time formatters) are used for the
  care-plan effective date and the conflict's overlapping visit times — **not** raw
  `toLocaleString()` or `Date` string interpolation, per the guardrail Increment A0 already
  enforced repo-wide (ad hoc `toLocaleString` calls were swept out once; this file must not
  reintroduce one).
- `ConfirmSubmitButton` replaces the plain `<Button type="submit">` — the `disabled={!canSubmit}`
  prop is new behavior (the old plain button relied only on native HTML `required` validation,
  which doesn't disable the button itself before a submit attempt); this is a real, minor UX
  improvement, not scope creep, since `canSubmit` was already needed to know when the summary
  panel has enough data to be meaningful.

- [ ] **Step 2: Typecheck (should now pass, completing Tasks 1+2 together)**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/visits/new/visit-form.tsx
git commit -m "C2: live scheduling summary, conflict check, and confirm gate in visits/new"
```

---

### Task 3: Full typecheck/lint pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 3: Fix and re-run if either fails**

Fix any reported issue in the file it names, re-run both until clean.

---

### Task 4: Verify in the browser against real local Postgres

**Files:** none (verification only)

This reuses Increment C1's already-verified seed-data eligibility split — all 5 seeded
clients share one zone ("Accra Central"), Adjoa Asante (`c0000000-0000-0000-0000-000000000001`)
is the sole eligible provider for all of them, and the seed already has one existing
`scheduled` visit for her (`f2000000-0000-0000-0000-000000000002`, client
`b0000000-0000-0000-0000-000000000002`).

- [ ] **Step 1: Start the stack**

`supabase status` (start with `supabase start` + `supabase db reset` if not running). Start
the dev server: `pnpm --filter ops-console dev` (background). Set a local dev password on
`coordinator1@carebridge.dev` if not already set this session:
```bash
curl -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/a0000000-0000-0000-0000-000000000001" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"password":"carebridge-dev-2026"}'
```

- [ ] **Step 2: Confirm the summary panel appears progressively**

Log in as `coordinator1@carebridge.dev` / `carebridge-dev-2026`, go to `/visits/new`. Confirm
no summary panel is visible before selecting a client. Select a client that has a care plan
(any of the 5 seeded clients do, per prior increments' verification). Confirm the panel now
shows "Zone: Accra Central" and "Care plan: effective `<date>`: `<summary text>`" — read the
actual rendered text, not a screenshot guess. Select a client that would have no care plan if
one existed without one (not expected in seed data — if all 5 seeded clients have a care plan,
skip this specific empty-state check and note that it wasn't exercisable against seed data
without fabricating a fixture, per this session's pattern of not silently claiming untested
paths as tested).

- [ ] **Step 3: Confirm the client.status B3 gate (unrelated to C2, but blocks scheduling)**

Since B3's activation gate, seeded clients default to `status = 'inactive'` (seed rows are
inserted directly, bypassing the onboarding RPC that flips them active — a known interaction
noted during C1's own verification). Before scheduling, reactivate the chosen client via its
`/clients/[id]` page's existing "Reactivate client" action if needed — confirm via
`docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c "select status from client where id = '<id>';"`
that it reads `active`.

- [ ] **Step 4: Confirm the conflict warning appears for an overlapping time**

Query Adjoa Asante's existing seeded visit's actual stored times (don't assume a fixed date —
seed data uses relative `now() - interval '1 day'` expressions, so the real value depends on
when `db reset` last ran):
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c "select scheduled_start, scheduled_end from visit where id = 'f2000000-0000-0000-0000-000000000002';"
```
In the browser, select any active client, select Adjoa Asante as provider, and enter
start/end datetime values that overlap the queried range (e.g. starting 30 minutes before the
existing visit's `scheduled_start` and ending 30 minutes after it). Confirm the summary panel
shows a warning line naming the conflicting client
(`b0000000-0000-0000-0000-000000000002`'s `full_name` — look it up if not already known) and
the correct overlapping time range in Accra-time format (matching `formatDateTime`'s output
shape, e.g. "... Accra time (GMT)"). Confirm the `ConfirmSubmitButton`'s dialog (open it by
clicking "Schedule visit") also states the same conflict.

- [ ] **Step 5: Confirm submitting anyway still succeeds (conflict is advisory, not a hard block)**

With the conflicting time still filled in, confirm the dialog. Confirm the visit is created
despite the conflict:
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c "select count(*) from visit where provider_id = 'c0000000-0000-0000-0000-000000000001' and status = 'scheduled';"
```
Expected: count increased by 1 from before this step (2 scheduled visits for Adjoa Asante now
— the original seeded one plus this new overlapping one). This is the proof that the conflict
check is genuinely advisory, not silently blocking.

- [ ] **Step 6: Confirm a non-overlapping time shows no conflict**

Change the scheduled start/end to a time range that doesn't overlap any of Adjoa Asante's
existing visits. Confirm the summary panel shows no conflict warning, and the
`ConfirmSubmitButton` dialog's text matches the no-conflict wording (no mention of an
overlapping visit).

- [ ] **Step 7: Confirm the confirm gate itself is disabled until the form is complete**

On a fresh page load (or by clearing fields), confirm clicking "Schedule visit" with any of
client/provider/start/end empty does not open the confirmation dialog at all (the button is
disabled — clicking it should do nothing, not open an empty/broken dialog).

- [ ] **Step 8: Clean up**

`supabase db reset` to wipe test visits and return to clean seed state. Stop the dev server.
`supabase stop`.

No code changes in this task. If any step's actual result doesn't match expected, do not
patch ad hoc — report exactly what happened so the relevant task above can be fixed.

---

### Task 5: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off Increment C2**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist):

```
  - [ ] Increment C2 (worker-tier, no schema): surface care-plan version, zone, required skill, and conflicts in the scheduling summary before confirmation
```

Replace with a checked line summarizing what was actually built and verified, in this file's
established style. Record at minimum: "required skill" was dropped as unmodeled (same call as
B3's "supervisor review"/"approved care plan"); the confirmed advisory-not-blocking scope
decision for conflicts and why; the controlled-state refactor of the client/provider selects
(replacing C1's key-remount trick) and the specific timing hazard it avoids; and the real
verification performed (conflict detected against real seed data, confirmed advisory via an
actual successful double-booked schedule, confirmed the empty-form disabled gate).

- [ ] **Step 2: Update the "Last updated" summary line**

Update the top summary line to reflect C2 is done and name Increment C3 as next, per the
epic's own ordering (confirm against the roadmap's own checklist rather than trusting this
plan's memory of it, in case the list has changed since this plan was written).

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment C2, next up Increment C3"
```

(Confirm the actual next-increment number against the roadmap's own checklist before writing
this commit message — don't assume C3 vs D1 without checking, since the epic's ordering is the
source of truth, not this plan's guess.)
