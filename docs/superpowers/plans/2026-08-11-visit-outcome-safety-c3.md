# Visit-Outcome Safety-First Redesign (Increment C3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/ops-console/app/visits/[id]/log/` asks "Is the client safe right now?" as a
first-class, mandatory question immediately after arrival time — not a checkbox — branching to
a dominant, critical-severity-locked escalation block when the answer is "No," or to the
existing routine tasks/observations plus an optional, non-critical "report a concern" toggle
when "Yes." Severity guidance (response-target minutes) is shown inline wherever a severity is
selectable. `logVisitOutcome` re-derives and enforces the same lock server-side.

**Architecture:** `app/exceptions/constants.ts` gains one more export
(`SEVERITY_BADGE_VARIANT`, currently module-private inside `exceptions/page.tsx`) so both
surfaces read the same severity→badge-color mapping. `log-form.tsx` is rewritten around a new
`clientSafe` state branch. `actions.ts`'s `logVisitOutcome` gains one new required field and
forces `severity = 'critical'` server-side whenever `clientSafe === 'no'`, ignoring any
submitted severity value on that branch entirely.

**Tech Stack:** Next.js App Router client component + server action, plain TypeScript. No test
runner exists for `ops-console` — verification is `typecheck`/`lint` plus a real browser
walkthrough, matching every prior increment.

**Spec:** `docs/superpowers/specs/2026-08-11-visit-outcome-safety-c3-design.md`

---

### Task 1: Export `SEVERITY_BADGE_VARIANT` from `exceptions/constants.ts`

**Files:**
- Modify: `apps/ops-console/app/exceptions/constants.ts`
- Modify: `apps/ops-console/app/exceptions/page.tsx`

- [ ] **Step 1: Add the export to `constants.ts`**

Current file ends (line 43) with the `SEVERITY_LABEL` export. Add immediately after it:

```ts

export const SEVERITY_BADGE_VARIANT: Record<string, "critical" | "warning" | "information" | "neutral"> = {
  critical: "critical",
  high: "warning",
  medium: "information",
  low: "neutral",
};
```

- [ ] **Step 2: Remove the module-private duplicate from `page.tsx` and import it instead**

In `apps/ops-console/app/exceptions/page.tsx`, the import block currently reads:

```ts
import {
  CRITICAL_RESOLVER_ROLE_SLUGS,
  OUTCOME_CATEGORIES,
  OUTCOME_CATEGORY_LABEL,
  SEVERITY_LABEL,
  SEVERITY_RANK,
} from "./constants";
```

Change it to also import `SEVERITY_BADGE_VARIANT`:

```ts
import {
  CRITICAL_RESOLVER_ROLE_SLUGS,
  OUTCOME_CATEGORIES,
  OUTCOME_CATEGORY_LABEL,
  SEVERITY_BADGE_VARIANT,
  SEVERITY_LABEL,
  SEVERITY_RANK,
} from "./constants";
```

Then delete the now-redundant local declaration a few lines below (currently right after the
imports):

```ts
const SEVERITY_BADGE_VARIANT: Record<string, "critical" | "warning" | "information" | "neutral"> = {
  critical: "critical",
  high: "warning",
  medium: "information",
  low: "neutral",
};
```

Everything else in `page.tsx` that references `SEVERITY_BADGE_VARIANT` (the escalation-list
badge and the case-detail badge) is unchanged — it's the same identifier, now imported instead
of locally declared, so no other line in this file needs to change.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter ops-console typecheck` — expected: no errors.
Run: `pnpm --filter ops-console lint` — expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/exceptions/constants.ts apps/ops-console/app/exceptions/page.tsx
git commit -m "C3: export SEVERITY_BADGE_VARIANT from exceptions/constants for reuse"
```

---

### Task 2: `log-form.tsx` — safety-first branch, severity guidance

**Files:**
- Modify: `apps/ops-console/app/visits/[id]/log/log-form.tsx`

- [ ] **Step 1: Replace the whole file**

Current file (112 lines) has arrival time, a tasks fieldset, an observations fieldset, and an
escalation fieldset gated by a plain checkbox with a free severity dropdown (low through
critical). Replace its full content with:

```tsx
"use client";

import { useState } from "react";
import { Button, StatusBadge } from "@carebridge/ui";
import { RESPONSE_TARGET_MINUTES, SEVERITY_BADGE_VARIANT, SEVERITY_LABEL } from "@/app/exceptions/constants";

const CONCERN_SEVERITIES = ["high", "medium", "low"] as const;

// "15 min" / "1h" / "4h" / "1d" — a short, readable form of the response-target policy for
// inline guidance next to a severity choice. Distinct from exceptions/utils.ts's
// formatResponseTarget, which computes a live countdown from a stored created_at; this is a
// static duration label with no time-of-day dependency.
function formatTargetDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export function LogVisitForm({
  action,
  error,
}: {
  action: (formData: FormData) => void;
  error?: string;
}) {
  const [taskCount, setTaskCount] = useState(1);
  const [observationCount, setObservationCount] = useState(1);
  const [clientSafe, setClientSafe] = useState<"yes" | "no" | "">("");
  const [concernFlagged, setConcernFlagged] = useState(false);
  const [concernSeverity, setConcernSeverity] = useState("");

  return (
    <form action={action} className="flex w-full max-w-xl flex-col gap-6">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Arrival time
        <input
          type="datetime-local"
          name="arrivedAt"
          required
          className="rounded-md border border-border px-3 py-2"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-lg font-medium">Is the client safe right now?</legend>
        <input type="hidden" name="clientSafe" value={clientSafe} />
        <div className="flex gap-3">
          <Button
            type="button"
            variant={clientSafe === "yes" ? "default" : "outline"}
            onClick={() => setClientSafe("yes")}
          >
            Yes, client is safe
          </Button>
          <Button
            type="button"
            variant={clientSafe === "no" ? "destructive" : "outline"}
            onClick={() => {
              setClientSafe("no");
              setConcernFlagged(false);
              setConcernSeverity("");
            }}
          >
            No, safety concern
          </Button>
        </div>
      </fieldset>

      {clientSafe === "no" ? (
        <fieldset className="flex flex-col gap-3 rounded-md border border-critical/30 bg-critical/5 p-4">
          <legend className="flex items-center gap-2 text-lg font-medium">
            Escalation
            <StatusBadge variant={SEVERITY_BADGE_VARIANT.critical} label={SEVERITY_LABEL.critical} />
          </legend>
          <p className="text-sm text-muted-foreground">
            Response target: {formatTargetDuration(RESPONSE_TARGET_MINUTES.critical)}. This notifies the
            coordinator and clinical director immediately.
          </p>
          <textarea
            name="escalationReason"
            placeholder="What's happening? Be specific."
            required
            rows={3}
            className="rounded-md border border-border px-3 py-2"
          />
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Tasks completed</legend>
        {Array.from({ length: taskCount }, (_, index) => (
          <input
            key={index}
            name="taskDescription"
            placeholder="Task description"
            className="rounded-md border border-border px-3 py-2"
          />
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setTaskCount((count) => count + 1)}>
          Add another task
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Observations</legend>
        {Array.from({ length: observationCount }, (_, index) => (
          <div key={index} className="flex gap-2">
            <input
              name="observationType"
              placeholder="Type (e.g. blood pressure)"
              className="flex-1 rounded-md border border-border px-3 py-2"
            />
            <input
              name="observationValue"
              placeholder="Value"
              className="flex-1 rounded-md border border-border px-3 py-2"
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setObservationCount((count) => count + 1)}
        >
          Add another observation
        </Button>
      </fieldset>

      {clientSafe === "yes" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-lg font-medium">Non-urgent concern</legend>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              name="concernFlagged"
              checked={concernFlagged}
              onChange={(event) => setConcernFlagged(event.currentTarget.checked)}
            />
            Report a non-urgent concern for this visit
          </label>
          {concernFlagged ? (
            <>
              <select
                name="escalationSeverity"
                required
                value={concernSeverity}
                onChange={(event) => setConcernSeverity(event.target.value)}
                className="rounded-md border border-border px-3 py-2"
              >
                <option value="" disabled>
                  Select severity
                </option>
                {CONCERN_SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABEL[severity]} — response target {formatTargetDuration(RESPONSE_TARGET_MINUTES[severity])}
                  </option>
                ))}
              </select>
              {concernSeverity ? (
                <StatusBadge
                  variant={SEVERITY_BADGE_VARIANT[concernSeverity]}
                  label={SEVERITY_LABEL[concernSeverity]}
                />
              ) : null}
              <textarea
                name="escalationReason"
                placeholder="Reason"
                required
                rows={3}
                className="rounded-md border border-border px-3 py-2"
              />
            </>
          ) : null}
        </fieldset>
      ) : null}

      {error ? <p className="text-sm text-critical">{error}</p> : null}
      <Button type="submit" disabled={clientSafe === ""}>
        Log visit outcome
      </Button>
    </form>
  );
}
```

Notes on real decisions here, not arbitrary choices:

- `clientSafe` is tracked in React state and mirrored into a hidden `<input>` for form
  submission — a native `required` radio group was considered but HTML's `required`
  attribute has no effect on `type="hidden"` inputs, so the submit button is explicitly
  `disabled={clientSafe === ""}` instead (same "disable until the required choice is made"
  idiom Increment C2 just established for its own confirm button).
- The "No" and "Yes" branches both use the `escalationReason`/`escalationSeverity` field
  names, but are mutually exclusive in the rendered DOM (only one `fieldset` is ever mounted
  at a time depending on `clientSafe`), so `FormData` only ever contains one value per key —
  no collision.
- `CONCERN_SEVERITIES` deliberately excludes `critical` — that severity is only reachable via
  the "No" branch, per the design's "no free-standing critical choice" decision.
- `StatusBadge`/`SEVERITY_BADGE_VARIANT` usage here is what makes Task 1's export a real reuse,
  not a speculative one — the critical block's badge and the concern-severity live preview
  both consume it, matching the exceptions page's own visual language for severity.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck` — expected: no errors (Task 1 already landed the
`SEVERITY_BADGE_VARIANT` export this file imports).

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint` — expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/visits/[id]/log/log-form.tsx
git commit -m "C3: safety-first branch and severity guidance in visit-outcome form"
```

---

### Task 3: `actions.ts` — enforce the safety lock server-side

**Files:**
- Modify: `apps/ops-console/app/visits/[id]/log/actions.ts`

- [ ] **Step 1: Replace the whole file**

Current file (105 lines) reads `escalationFlagged`/`escalationSeverity`/`escalationReason`
directly from `FormData` with no safety-question concept. Replace its full content with:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { notifyEscalationOpened, notifyVisitComplete } from "@/lib/whatsapp";

const CONCERN_SEVERITIES = new Set(["high", "medium", "low"]);

export async function logVisitOutcome(visitId: string, formData: FormData) {
  const arrivedAt = String(formData.get("arrivedAt") ?? "");

  if (!arrivedAt) {
    redirect(`/visits/${visitId}/log?error=${encodeURIComponent("Arrival time is required.")}`);
  }

  const clientSafe = String(formData.get("clientSafe") ?? "");

  if (clientSafe !== "yes" && clientSafe !== "no") {
    redirect(
      `/visits/${visitId}/log?error=${encodeURIComponent("Please answer whether the client is safe right now.")}`,
    );
  }

  const taskDescriptions = formData.getAll("taskDescription").map(String).map((task) => task.trim()).filter(Boolean);

  const observationTypes = formData.getAll("observationType").map(String);
  const observationValues = formData.getAll("observationValue").map(String);
  const observations = observationTypes
    .map((type, index) => ({ type: type.trim(), value: (observationValues[index] ?? "").trim() }))
    .filter((observation) => observation.type && observation.value);

  const escalationReasonInput = String(formData.get("escalationReason") ?? "").trim();
  const submittedSeverity = String(formData.get("escalationSeverity") ?? "");

  let escalationToCreate: { severity: string; reason: string } | null = null;

  if (clientSafe === "no") {
    if (!escalationReasonInput) {
      redirect(
        `/visits/${visitId}/log?error=${encodeURIComponent("A reason is required when the client is not safe.")}`,
      );
    }

    // Severity is forced to critical here regardless of anything submitted — a submitted
    // escalationSeverity value on this branch (there shouldn't be one from the real UI, but a
    // direct/bypassed request could send one) is never read, let alone trusted.
    escalationToCreate = { severity: "critical", reason: escalationReasonInput };
  } else {
    const concernFlagged = formData.get("concernFlagged") === "on";

    if (concernFlagged) {
      if (!CONCERN_SEVERITIES.has(submittedSeverity) || !escalationReasonInput) {
        redirect(
          `/visits/${visitId}/log?error=${encodeURIComponent("Severity (high, medium, or low) and a reason are required to report a concern.")}`,
        );
      }

      escalationToCreate = { severity: submittedSeverity, reason: escalationReasonInput };
    }
  }

  const supabase = await createClient();

  const { data: visit, error: visitError } = await supabase
    .from("visit")
    .select("id, client_id")
    .eq("id", visitId)
    .maybeSingle();

  if (visitError || !visit) {
    redirect(`/visits/log?error=${encodeURIComponent("Visit not found.")}`);
  }

  const { data: client } = await supabase.from("client").select("zone_id").eq("id", visit.client_id).maybeSingle();

  const { error: checkinError } = await supabase.from("visit_checkin").insert({
    visit_id: visitId,
    event: "arrived",
    occurred_at: arrivedAt,
    zone_id: client?.zone_id ?? null,
  });

  if (checkinError) {
    redirect(`/visits/${visitId}/log?error=${encodeURIComponent(checkinError.message)}`);
  }

  if (taskDescriptions.length > 0) {
    const { error: taskError } = await supabase.from("task").insert(
      taskDescriptions.map((description) => ({ visit_id: visitId, description, completed: true })),
    );

    if (taskError) {
      redirect(`/visits/${visitId}/log?error=${encodeURIComponent(taskError.message)}`);
    }
  }

  if (observations.length > 0) {
    const { error: observationError } = await supabase.from("observation").insert(
      observations.map((observation) => ({
        visit_id: visitId,
        type: observation.type,
        value: observation.value,
      })),
    );

    if (observationError) {
      redirect(`/visits/${visitId}/log?error=${encodeURIComponent(observationError.message)}`);
    }
  }

  if (escalationToCreate) {
    const { error: escalationError } = await supabase.from("escalation").insert({
      client_id: visit.client_id,
      visit_id: visitId,
      severity: escalationToCreate.severity,
      reason: escalationToCreate.reason,
    });

    if (escalationError) {
      redirect(`/visits/${visitId}/log?error=${encodeURIComponent(escalationError.message)}`);
    }

    await notifyEscalationOpened(supabase, escalationToCreate.severity);
  }

  const { error: statusError } = await supabase.from("visit").update({ status: "completed" }).eq("id", visitId);

  if (statusError) {
    redirect(`/visits/${visitId}/log?error=${encodeURIComponent(statusError.message)}`);
  }

  await notifyVisitComplete(supabase, visit.client_id);

  redirect(`/visits/log?logged=${visitId}`);
}
```

The only real logic change from the previous version: `escalationFlagged` (a single boolean)
is replaced by the `clientSafe` branch, which either unconditionally builds a
`{ severity: 'critical', ... }` escalation (no trust in any submitted severity) or, on the
"yes" branch, validates a submitted severity against `CONCERN_SEVERITIES` (high/medium/low
only — a submitted `critical` here is rejected as invalid, not silently downgraded).
Everything after `escalationToCreate` is computed (checkin/task/observation inserts, the
`escalation` insert itself, `notifyEscalationOpened`, visit completion, `notifyVisitComplete`)
is byte-identical to the version before this task.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck` — expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint` — expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/visits/[id]/log/actions.ts
git commit -m "C3: enforce critical-severity lock server-side when client is not safe"
```

---

### Task 4: Full typecheck/lint pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter ops-console typecheck` — expected: no errors.

- [ ] **Step 2: Lint**

Run: `pnpm --filter ops-console lint` — expected: no errors.

- [ ] **Step 3: Fix and re-run if either fails**

Fix any reported issue in the file it names, re-run both until clean.

---

### Task 5: Verify in the browser against real local Postgres

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

`supabase status` (start with `supabase start` + `supabase db reset` if not running, for clean
seed state). Start the dev server: `pnpm --filter ops-console dev` (background). Set a local
dev password on `coordinator1@carebridge.dev` if not already set this session:
```bash
curl -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/a0000000-0000-0000-0000-000000000001" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"password":"carebridge-dev-2026"}'
```

- [ ] **Step 2: Find a loggable visit**

Log in as `coordinator1@carebridge.dev` / `carebridge-dev-2026`, go to `/visits/log` (the
list of visits not yet completed) and open one of them — or if none are `scheduled`, schedule
a fresh one via `/visits/new` first (an active client + Adjoa Asante, same seed data C1/C2
verification already used) and open its `/visits/[id]/log` page.

- [ ] **Step 3: Confirm the "Yes" branch behaves as before, plus the new optional concern**

Fill arrival time, click "Yes, client is safe" — confirm no critical block appears. Confirm
the submit button is enabled only once "Yes"/"No" has been chosen (reload the page and confirm
it's disabled before choosing either). Fill a task and an observation as before. Check "Report
a non-urgent concern for this visit" — confirm the severity `<select>` offers exactly three
options (High, Medium, Low — read the actual option text, confirm no "Critical" option is
present at all) each showing response-target guidance text (e.g. "High — response target 1h").
Select one — confirm a `StatusBadge` matching that severity's color appears live below the
select. Fill a reason, submit. Confirm via Postgres:
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c "select severity, reason from escalation where visit_id = '<visit-id>';"
```
Expected: the row exists with the exact severity chosen (not critical) and the entered reason.

- [ ] **Step 4: Confirm the "No" branch is dominant and locks to critical**

Open another loggable visit. Fill arrival time, click "No, safety concern" — confirm a
red-tinted (`border-critical/30 bg-critical/5`) block appears immediately, above the tasks/
observations fieldsets, showing a "Critical" `StatusBadge` and the response-target text ("15
min"). Confirm there is no severity dropdown anywhere in this block — severity is not a user
choice here. Fill the required reason, submit. Confirm via Postgres:
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c "select severity, reason from escalation where visit_id = '<visit-id>';"
```
Expected: `severity = 'critical'`, reason matches what was entered.

- [ ] **Step 5: Confirm the server-side lock is real, not just a disabled UI**

Prove `logVisitOutcome`'s forced-critical logic is real by bypassing the UI: use devtools to
submit a request with `clientSafe=no` but a spoofed `escalationSeverity=low` field added to the
form data (e.g. via the browser console constructing and submitting a `FormData` with both
fields, or editing the DOM to inject a hidden `escalationSeverity` input before submitting).
Confirm the resulting `escalation` row still lands with `severity = 'critical'`, not `low` —
proving the server ignores any submitted severity on this branch rather than merely validating
it.

- [ ] **Step 6: Confirm `notifyEscalationOpened`'s critical routing still fires correctly**

For the critical escalation created in Step 4, confirm both a `coordinator` and the
`clinical_director` role received a `notification` row (matching this function's existing,
unchanged severity-based routing — CLAUDE.md's safeguarding-routing rule):
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres -c "select u.full_name, r.slug from notification n join \"user\" u on u.id = n.user_id join role r on r.id = u.role_id where n.created_at > now() - interval '5 minutes' order by n.created_at desc;"
```
(Adjust the interval/filter if needed to isolate the notifications from this test.) Expected:
at least one `coordinator` and one `clinical_director` row.

- [ ] **Step 7: Clean up**

`supabase db reset` to wipe test data and return to clean seed state. Stop the dev server.
`supabase stop`.

No code changes in this task. If any step's actual result doesn't match expected, do not patch
ad hoc — report exactly what happened so the relevant task above can be fixed.

---

### Task 6: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off Increment C3**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist):

```
  - [ ] Increment C3 (worker-tier, no schema): redesign visit-outcome capture so escalation is a first-class branch (not a small checkbox) with severity guidance and an explicit "is the client safe right now" prompt ahead of routine completion fields
```

Replace with a checked line summarizing what was actually built and verified, in this file's
established style. Record at minimum: the confirmed hard-lock-to-critical scope decision and
why; the `SEVERITY_BADGE_VARIANT` extraction into shared constants (same reasoning as C1's
`provider-eligibility.ts`); and the real verification performed (both branches walked in the
browser, the server-side bypass test proving the lock isn't UI-only, and the notification
routing check).

- [ ] **Step 2: Update the "Last updated" summary line**

Update the top summary line to reflect C3 is done and name Increment D1 as next, per the
epic's own ordering (confirm against the roadmap's own checklist rather than trusting this
plan's memory of it).

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment C3, next up Increment D1"
```
