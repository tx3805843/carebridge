# Increment C3: visit-outcome safety-first redesign — design

**Date:** 2026-08-11
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic, Increment C3

## Context

Roadmap scope: "redesign visit-outcome capture so escalation is a first-class branch (not a
small checkbox) with severity guidance and an explicit 'is the client safe right now' prompt
ahead of routine completion fields."

Confirmed real against the live code: `apps/ops-console/app/visits/[id]/log/log-form.tsx`'s
escalation section today is a single `<input type="checkbox">` ("Flag an escalation for this
visit") below the tasks/observations fieldsets, revealing a plain severity dropdown (low/
medium/high/critical, no guidance) and a reason textarea only once checked. There is no safety
question anywhere in the form — a critical safeguarding concern and a routine completed-task
list are visually equal weight, exactly the review's complaint.

## Scope decision: severity locked to Critical when unsafe

Confirmed with the user directly: when the coordinator answers "No" to "is the client safe
right now," severity is **hard-locked to `critical`**, not merely defaulted. "Not safe right
now" already is the operational definition of critical severity per the existing exceptions
page's response-target policy (`RESPONSE_TARGET_MINUTES.critical = 15` minutes,
`app/exceptions/constants.ts`) — a free-standing severity choice at that point would
reintroduce exactly the ambiguity this redesign exists to remove. This is enforced both in the
UI (severity shown as fixed text, not a selectable dropdown) and re-derived server-side (never
trusting a submitted severity value for this branch).

## Flow

1. **Arrival time** — unchanged, first field, unrelated to this redesign.
2. **"Is the client safe right now?"** — new, mandatory, binary (Yes/No — not a checkbox, a
   clearly-styled prompt that visually dominates the top of the form immediately after arrival
   time). This is the first substantive question, ahead of tasks/observations, per the
   roadmap's explicit ordering requirement.
3. **"No" branch** — reveals an escalation block styled like the exceptions page's own
   critical-card treatment (`border-critical/30 bg-critical/5`, the exact class pairing already
   used there — visual consistency, not a new design language for the same meaning). Severity
   shown as fixed "Critical" text (not editable), reason required. This block renders **above**
   the routine task/observation fieldsets, which remain fillable (real visit content may have
   happened before or alongside the concern) but are visually secondary — a safety concern
   should never be scrolled past to reach it.
4. **"Yes" branch** — routine fieldsets (tasks, observations) render as they do today,
   unchanged. A still-optional "Report a non-urgent concern" toggle offers medium/high/low
   severity only — critical is structurally unreachable from this branch, since a "Yes" to the
   safety question is incompatible with a concurrent critical-severity concern; a coordinator
   who realizes there's an immediate risk mid-form should go back and change the safety answer,
   not select "Yes, safe" plus "Critical" side by side. Each severity option shows its response-
   target guidance inline (e.g. "High — response target 60 min"), reusing
   `RESPONSE_TARGET_MINUTES`/`SEVERITY_LABEL` from `app/exceptions/constants.ts` — the "severity
   guidance" the roadmap line asks for, sourced from the one place this policy already lives
   rather than a second copy.

## Shared constants

`SEVERITY_LABEL` and `RESPONSE_TARGET_MINUTES` already live in `app/exceptions/constants.ts`
and get imported here directly. `SEVERITY_BADGE_VARIANT` currently lives as a module-private
`const` inside `exceptions/page.tsx` (not exported) — moved into `constants.ts` and exported,
so both this form and the exceptions page read the same severity→badge-color mapping instead of
risking a second copy drifting out of sync. This mirrors the exact reasoning behind
`lib/provider-eligibility.ts` in Increment C1 (shared logic in one place so two surfaces can't
silently disagree).

## Server (`actions.ts`)

`logVisitOutcome` gains one new required field, `clientSafe` (boolean, from the new Yes/No
prompt). Server-side: if `clientSafe === false`, the inserted `escalation.severity` is forced
to `'critical'` unconditionally — the submitted `escalationSeverity` field (if any) is ignored
entirely on this branch, not merely validated against it. This is the same defense-in-depth
posture this session has applied everywhere a client-side UI restriction exists (C1's
provider-eligibility re-check, B3's activation trigger) — never trust the browser for a
safety-critical decision. When `clientSafe === true`, the existing optional-escalation logic is
unchanged except severity is restricted to `medium`/`high`/`low` (a submitted `critical` value
on this branch is rejected, not silently downgraded — an honest error, not a silent
data-integrity fudge).

`clientSafe` itself is not persisted anywhere new — there's no schema field for "was the client
safe at this specific visit" as a standalone fact, and inventing one isn't asked for by the
roadmap line. It exists purely to drive which escalation path (if any) the coordinator is on;
the actual persisted signal is (or isn't) the resulting `escalation` row, same as today.

## Out of scope

- Any change to `visit_checkin`/`task`/`observation` insert logic — untouched.
- Any change to how escalations are displayed/resolved on the exceptions page — untouched,
  only its constants file gains one more export.
- A persisted "client safety at visit" field — deliberately not built (see above).

## Verification plan

Same bar as prior increments — real local Postgres, not just typechecked:

1. Browser: log an outcome answering "Yes" — confirm routine fields behave exactly as before,
   confirm the optional-concern toggle only offers medium/high/low (no critical option
   present at all), confirm each option shows its response-target guidance text.
2. Browser: log an outcome answering "No" — confirm the critical-styled block appears
   immediately (above tasks/observations), confirm severity renders as fixed "Critical" text
   with no dropdown, confirm submitting creates a real `escalation` row with
   `severity = 'critical'`, confirmed via direct Postgres query.
3. Attempt to bypass the UI (e.g. devtools) to submit `clientSafe=false` with a spoofed
   non-critical `escalationSeverity` value directly against the server action — confirm the
   server still forces/enforces `critical`, proving the lock is real server-side, not just a
   disabled UI control.
4. Confirm `notifyEscalationOpened`'s existing severity-based routing (critical also alerts the
   clinical director, per CLAUDE.md) still fires correctly for a critical escalation created via
   the new "No" branch — no regression to the existing notification logic.
5. `pnpm --filter ops-console typecheck` and `lint` clean.
