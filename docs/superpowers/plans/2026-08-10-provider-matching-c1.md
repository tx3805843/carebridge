# Eligibility-Aware Provider Matching (Increment C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/visits/new` filters the provider picker to eligible providers by default (roster
zone match + `verified_profile.nmc_licensed` for nurses + `employment_status = 'active'`),
shows blocked providers separately with the specific reason(s), and `scheduleVisit` re-checks
the same three signals server-side before inserting a `visit` row.

**Architecture:** A small pure-logic module (`lib/provider-eligibility.ts`) computes blocked
reasons for a (provider, target zone) pair and a provider's "current zone" from their roster
history — shared by both the page (precomputes a client×provider eligibility matrix at page
load) and the server action (re-derives eligibility for the one submitted pair before
inserting). No schema change — all three signals already exist as columns.

**Tech Stack:** Next.js App Router server components + server actions, Supabase JS client,
plain TypeScript (no test runner exists for `ops-console` — verification is
`typecheck`/`lint` plus a real browser + Postgres walkthrough, matching every prior
increment this session).

**Spec:** `docs/superpowers/specs/2026-08-10-provider-matching-c1-design.md`

---

### Task 1: Shared eligibility logic module

**Files:**
- Create: `apps/ops-console/lib/provider-eligibility.ts`

- [ ] **Step 1: Write the complete module**

```ts
// Pure logic shared by app/visits/new/page.tsx (precomputes eligibility for every
// client×provider pair) and app/visits/new/actions.ts (re-derives it for the one
// submitted pair before inserting a visit) — kept in one place so the UI's blocked-option
// wording and the server's rejection message can never drift apart.

export interface RosterAssignment {
  providerId: string;
  zoneId: string;
  weekStarting: string; // ISO date string (YYYY-MM-DD) — lexically sortable
}

// A provider's "current" zone is their single most-recent roster row by week_starting,
// across all zones they've ever been assigned to — not resolved against a specific visit
// date. roster.week_starting is a free-form date with no week-boundary normalization
// anywhere in this app, so there's no existing concept of "the roster as it will stand on
// a future date" to check against; this matches how /roster itself already presents
// "current" (the latest row, full stop). Returns null if the provider has no roster row at
// all.
export function getCurrentZoneId(providerId: string, assignments: RosterAssignment[]): string | null {
  const rows = assignments.filter((row) => row.providerId === providerId);

  if (rows.length === 0) {
    return null;
  }

  return rows.reduce((latest, row) => (row.weekStarting > latest.weekStarting ? row : latest)).zoneId;
}

export interface ProviderEligibilityProfile {
  providerId: string;
  isNurse: boolean;
  employmentStatus: string;
  nmcLicensed: boolean;
  currentZoneId: string | null;
  currentZoneName: string | null;
}

// Returns every reason this provider is blocked from a visit against a client in
// targetZoneId — empty array means eligible. A provider can fail more than one check at
// once; all applicable reasons are returned, not just the first.
export function getBlockedReasons(profile: ProviderEligibilityProfile, targetZoneId: string): string[] {
  const reasons: string[] = [];

  // NMC PIN/AIN licensing only applies to nurses — caregivers have no equivalent statutory
  // credential (CLAUDE.md, matches the existing roster/actions.ts#addRosterAssignment guard).
  if (profile.isNurse && !profile.nmcLicensed) {
    reasons.push("NMC PIN/AIN not licensed");
  }

  if (profile.employmentStatus !== "active") {
    reasons.push(profile.employmentStatus === "on_leave" ? "on leave" : "no longer active (departed)");
  }

  if (profile.currentZoneId !== targetZoneId) {
    reasons.push(profile.currentZoneId ? `rostered to ${profile.currentZoneName}` : "not yet rostered to any zone");
  }

  return reasons;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors (this file has no callers yet, so it should typecheck standalone).

- [ ] **Step 3: Commit**

```bash
git add apps/ops-console/lib/provider-eligibility.ts
git commit -m "C1: add shared provider-eligibility logic module"
```

---

### Task 2: `page.tsx` — compute the client×provider eligibility matrix

**Files:**
- Modify: `apps/ops-console/app/visits/new/page.tsx`

- [ ] **Step 1: Replace the whole file**

Current file (39 lines, already known) fetches `client`(id, full_name) and
`provider`(id, user_id) with no eligibility data. Replace its full content with:

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

  const [{ data: clients }, { data: providers }, { data: roles }, { data: verifiedProfiles }, { data: rosterRows }, { data: zones }] =
    await Promise.all([
      supabase.from("client").select("id, full_name, zone_id").order("full_name"),
      supabase.from("provider").select("id, user_id, employment_status"),
      supabase.from("role").select("id, slug"),
      supabase.from("verified_profile").select("provider_id, nmc_licensed"),
      supabase.from("roster").select("provider_id, zone_id, week_starting"),
      supabase.from("zone").select("id, name"),
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

  const rosterAssignments = (rosterRows ?? []).map((row) => ({
    providerId: row.provider_id,
    zoneId: row.zone_id,
    weekStarting: row.week_starting,
  }));

  const providerProfiles = (providers ?? []).map((provider) => {
    const user = providerUserById.get(provider.user_id);
    const roleSlug = user ? roleSlugById.get(user.role_id) : undefined;
    const currentZoneId = getCurrentZoneId(provider.id, rosterAssignments);

    const profile: ProviderEligibilityProfile = {
      providerId: provider.id,
      isNurse: roleSlug === "nurse",
      employmentStatus: provider.employment_status,
      nmcLicensed: nmcLicensedByProviderId.get(provider.id) ?? false,
      currentZoneId,
      currentZoneName: currentZoneId ? (zoneNameById.get(currentZoneId) ?? null) : null,
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

  return (
    <AppShell user={staffUser}>
      <PageHeader title="Schedule a visit" />
      {visitScheduled ? <p className="mb-4 text-sm text-success">Visit scheduled.</p> : null}
      <VisitForm clients={clientOptions} matrix={matrix} error={error} />
    </AppShell>
  );
}
```

Note this computes the matrix for every client up front (pilot scale — 5 clients × 6
providers today), a deliberate scope decision from the design doc, not an oversight — noted
there as a real scaling limit if this app ever grows past pilot size.

- [ ] **Step 2: Confirm it does not yet typecheck (VisitForm's props haven't changed)**

Run: `pnpm --filter ops-console typecheck`
Expected: FAILS — `VisitForm` (Task 3, not done yet) still expects `providers`, not `matrix`.
This is expected; do not fix it here.

- [ ] **Step 3: Commit**

```bash
git add apps/ops-console/app/visits/new/page.tsx
git commit -m "C1: compute client x provider eligibility matrix in visits/new"
```

(Committing a state that doesn't yet typecheck is acceptable here only because Task 3 lands
immediately after in the same task-execution session — do not leave this as the final state
of a review checkpoint.)

---

### Task 3: `visit-form.tsx` — client-driven provider picker with eligible/blocked optgroups

**Files:**
- Modify: `apps/ops-console/app/visits/new/visit-form.tsx`

- [ ] **Step 1: Replace the whole file**

Current file (70 lines, already known) takes `clients`/`providers` as flat `Option[]` props
with a static, unfiltered provider `<select>`. Replace its full content with:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@carebridge/ui";
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

export function VisitForm({
  clients,
  matrix,
  error,
}: {
  clients: Option[];
  matrix: Record<string, ClientEligibility>;
  error?: string;
}) {
  const [clientId, setClientId] = useState("");
  const eligibility = matrix[clientId];

  return (
    <form action={scheduleVisit} className="flex w-full max-w-xl flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Client
        <select
          name="clientId"
          required
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
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
          key={clientId}
          name="providerId"
          required
          defaultValue=""
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
          className="rounded-md border border-border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Scheduled end
        <input
          type="datetime-local"
          name="scheduledEnd"
          required
          className="rounded-md border border-border px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-critical">{error}</p> : null}
      <Button type="submit">Schedule visit</Button>
    </form>
  );
}
```

`key={clientId}` on the provider `<select>` forces a full remount when the client changes,
resetting the provider selection to unselected rather than leaving a stale, now-possibly-
invalid or now-blocked value selected — the same fix already used for this exact class of bug
in `app/exceptions/page.tsx` (`key={selectedEscalation.id}` on its detail-pane wrapper, added
after a real stale-selection bug was found during Increment A cont'd). Reusing a known fix,
not inventing a new one.

- [ ] **Step 2: Typecheck (this should now pass, completing Tasks 2+3 together)**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/visits/new/visit-form.tsx
git commit -m "C1: client-driven eligible/blocked provider picker in visits/new"
```

---

### Task 4: `actions.ts` — server-side eligibility re-check

**Files:**
- Modify: `apps/ops-console/app/visits/new/actions.ts`

- [ ] **Step 1: Replace the whole file**

Current file (after B3's fixes, ~53 lines) checks required fields, then client existence/
status, then care-plan existence, then inserts. Replace its full content with:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBlockedReasons, getCurrentZoneId, type ProviderEligibilityProfile } from "@/lib/provider-eligibility";

export async function scheduleVisit(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const scheduledStart = String(formData.get("scheduledStart") ?? "");
  const scheduledEnd = String(formData.get("scheduledEnd") ?? "");

  if (!clientId || !providerId || !scheduledStart || !scheduledEnd) {
    redirect(`/visits/new?error=${encodeURIComponent("Client, provider, and start/end times are all required.")}`);
  }

  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("client")
    .select("status, zone_id")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError || !client) {
    redirect(`/visits/new?error=${encodeURIComponent("Client not found.")}`);
  }

  if (client.status !== "active") {
    redirect(
      `/visits/new?error=${encodeURIComponent("This client is not active — reactivate them before scheduling a visit.")}`,
    );
  }

  const { data: provider, error: providerError } = await supabase
    .from("provider")
    .select("id, user_id, employment_status")
    .eq("id", providerId)
    .maybeSingle();

  if (providerError || !provider) {
    redirect(`/visits/new?error=${encodeURIComponent("Provider not found.")}`);
  }

  const [{ data: providerUser }, { data: nurseRole }, { data: verifiedProfile }, { data: rosterRows }, { data: zones }] =
    await Promise.all([
      supabase.from("user").select("role_id").eq("id", provider.user_id).maybeSingle(),
      supabase.from("role").select("id").eq("slug", "nurse").single(),
      supabase.from("verified_profile").select("nmc_licensed").eq("provider_id", providerId).maybeSingle(),
      supabase.from("roster").select("zone_id, week_starting").eq("provider_id", providerId),
      supabase.from("zone").select("id, name"),
    ]);

  const zoneNameById = new Map((zones ?? []).map((zone) => [zone.id, zone.name]));
  const currentZoneId = getCurrentZoneId(
    providerId,
    (rosterRows ?? []).map((row) => ({ providerId, zoneId: row.zone_id, weekStarting: row.week_starting })),
  );

  const profile: ProviderEligibilityProfile = {
    providerId,
    isNurse: providerUser?.role_id === nurseRole?.id,
    employmentStatus: provider.employment_status,
    nmcLicensed: verifiedProfile?.nmc_licensed ?? false,
    currentZoneId,
    currentZoneName: currentZoneId ? (zoneNameById.get(currentZoneId) ?? null) : null,
  };

  const blockedReasons = getBlockedReasons(profile, client.zone_id);

  if (blockedReasons.length > 0) {
    redirect(
      `/visits/new?error=${encodeURIComponent(`This provider isn't eligible for this client: ${blockedReasons.join("; ")}`)}`,
    );
  }

  const { data: carePlan, error: carePlanError } = await supabase
    .from("care_plan")
    .select("id")
    .eq("client_id", clientId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (carePlanError || !carePlan) {
    redirect(
      `/visits/new?error=${encodeURIComponent("This client has no care plan yet — add one before scheduling a visit.")}`,
    );
  }

  const { error: visitError } = await supabase.from("visit").insert({
    client_id: clientId,
    provider_id: providerId,
    care_plan_id: carePlan.id,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
  });

  if (visitError) {
    redirect(`/visits/new?error=${encodeURIComponent(visitError.message)}`);
  }

  redirect("/visits/new?visitScheduled=1");
}
```

This re-derives the exact same three signals `page.tsx` used to build the matrix, from
scratch, for just the one submitted (client, provider) pair — never trusting that the
submitted `providerId` was actually one the UI marked eligible. Uses the same
`getBlockedReasons`/`getCurrentZoneId` functions from Task 1, so the rejection message can't
drift from the UI's blocked-option wording.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/visits/new/actions.ts
git commit -m "C1: re-check provider eligibility server-side before scheduling a visit"
```

---

### Task 5: Full typecheck/lint pass

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

### Task 6: Verify in the browser against real local Postgres

**Files:** none (verification only)

This uses the seed data's existing, deliberately-mixed provider states — no new fixtures
needed. All 5 seeded clients share the same zone (`Accra Central`,
`d0000000-0000-0000-0000-000000000001`). The 6 seeded providers:

| Provider | Role | NMC licensed | Employment | Roster |
|---|---|---|---|---|
| Adjoa Asante (`c...0001`) | nurse | true | active | Accra Central |
| Kofi Owusu (`c...0002`) | nurse | false | departed | none |
| Akosua Darko (`c...0003`) | nurse | false | active | none |
| Kwabena Appiah (`c...0004`) | caregiver | n/a | active | none |
| Ama Boateng (`c...0005`) | caregiver | n/a | active | none |
| Yaa Asantewaa (`c...0006`) | caregiver | n/a | active | none |

Expected eligibility for **any** of the 5 seeded clients (all share the one seeded zone):
Adjoa Asante is the sole eligible provider; all five others are blocked.

- [ ] **Step 1: Start the stack**

`supabase status` (start with `supabase start` + `supabase db reset` if not running, to
guarantee clean seed state). Start the dev server: `pnpm --filter ops-console dev`
(background). Set a local dev password on `coordinator1@carebridge.dev` if not already set
this session:
```bash
curl -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/a0000000-0000-0000-0000-000000000001" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"password":"carebridge-dev-2026"}'
```
(`<SERVICE_ROLE_KEY>` and the API URL from `supabase status`.)

- [ ] **Step 2: Confirm the eligible/blocked split in the browser**

Log in as `coordinator1@carebridge.dev` / `carebridge-dev-2026`, go to `/visits/new`. Confirm
the provider `<select>` starts disabled with placeholder "Select a client first". Select any
client (e.g. Efua Asante). Confirm the provider select becomes enabled and shows:
- Under "Eligible": exactly one option, "Adjoa Asante".
- Under "Blocked": five disabled options, with these exact reason strings —
  - "Kofi Owusu — NMC PIN/AIN not licensed; no longer active (departed); not yet rostered to any zone"
  - "Akosua Darko — NMC PIN/AIN not licensed; not yet rostered to any zone"
  - "Kwabena Appiah — not yet rostered to any zone"
  - "Ama Boateng — not yet rostered to any zone"
  - "Yaa Asantewaa — not yet rostered to any zone"

Confirm the blocked options are genuinely unselectable (clicking one does nothing; the native
`disabled` attribute, not just greyed styling).

- [ ] **Step 3: Confirm switching clients resets the provider selection**

Select Adjoa Asante as the provider. Change the client dropdown to a different client.
Confirm the provider select resets to the "Select a provider" placeholder (not still showing
"Adjoa Asante" selected) — this is the `key={clientId}` remount from Task 3 working.

- [ ] **Step 4: Schedule a real visit with the eligible provider and confirm it succeeds**

Re-select a client, select Adjoa Asante, fill start/end times, submit. Confirm
"Visit scheduled." and a real `visit` row lands:
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c "select provider_id, status from visit where provider_id = 'c0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;"
```
Expected: the new row, `status = 'scheduled'`.

- [ ] **Step 5: Confirm the server-side backstop actually rejects a blocked provider**

Bypass the UI to prove the check in `actions.ts` (Task 4) is real, not just present in the
disabled UI — the disabled `<option>` alone would already stop a normal user, so this step
specifically proves the server doesn't just trust the client. Submit a raw request against
the server action's underlying route directly, e.g. via `curl` against the form's action URL
with a blocked `providerId`, or use browser devtools to remove the `disabled` attribute from
one blocked `<option>` and submit normally. Either way, confirm the response redirects to
`/visits/new?error=...` containing "This provider isn't eligible for this client:" followed
by that provider's exact reasons, and confirm via Postgres that no new `visit` row was
created for that provider:
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c "select count(*) from visit where provider_id = 'c0000000-0000-0000-0000-000000000003';"
```
Expected: `0` (Akosua Darko, still blocked — substitute whichever blocked provider was used).

- [ ] **Step 6: Clean up**

`supabase db reset` to wipe the test visit and return to clean seed state. Stop the dev
server. `supabase stop`.

No code changes in this task — if any step's actual result doesn't match expected, do not
patch ad hoc here; report exactly what happened so the relevant task above can be fixed.

---

### Task 7: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off Increment C1**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist):

```
  - [ ] Increment C1 (worker-tier, no schema): eligibility-aware provider matching in `/visits/new` — filter to eligible providers by default (roster zone match + `verified_profile.nmc_licensed` + `employment_status = 'active'`), list blocked providers separately with the exact reason, replacing today's reject-on-save behaviour
```

Replace with a checked line summarizing what was actually built and verified, in this file's
established style — do this once the work above is actually done, not as a template filled
blindly. Record at minimum: the real gap found (zero provider-eligibility checking existed
in `/visits/new` before this, not just an incomplete version of it); the "current zone" scope
decision (most-recent roster row, not date-of-visit matching, and why); the shared
`lib/provider-eligibility.ts` module and why it's shared between page and action; and the
real verification performed (exact seed-data eligible/blocked split, the stale-selection fix
reused from Increment A cont'd, the server-backstop bypass test).

- [ ] **Step 2: Update the "Last updated" summary line**

Update the top summary line to reflect C1 is done and name whichever increment (C2) is next
per the epic's own ordering.

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment C1, next up Increment C2"
```
