# Increment D5: loading/error/not-found states via a real layout — design

**Date:** 2026-08-12
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic — gap story logged closing D4 ("add
`loading.tsx`/`error.tsx` to `ops-console`'s priority routes — no route has either today").

## Context

D4's closing review checked the UX review's "Definition of professionally refreshed"
checklist against real repo state and found `apps/ops-console/app` has zero `loading.tsx` or
`error.tsx` files anywhere — every priority-workflow criterion the review names
("loading, empty, error, retry, permission, and confirmation states") is only partially met:
empty/permission/confirmation states exist per-page (already built across A-D4), loading and
error as a systemic Next.js pattern don't exist at all.

**A real architectural finding, not just a missing-file gap**: `AppShell`
(`components/app-shell.tsx`, the persistent sidebar/nav — the review's #1 finding, closed by
Increment A) is not in `layout.tsx`. Every one of the ~15 staff routes calls it fresh, itself,
inside its own `page.tsx`. Next.js `loading.tsx`/`error.tsx` render in place of whatever the
segment's `page.tsx` would render — they do **not** see anything a page.tsx renders around
itself. A `loading.tsx` dropped in next to today's page files would show a bare screen with no
sidebar while data loads, and disappear-then-reappear the nav on every navigation — worse than
today, and the opposite of what Increment A already fixed.

**Second, unprompted finding surfaced while investigating this**: because `AppShell` is
called fresh per-page rather than living in a persistent layout, it fully remounts on every
navigation today — including its `ToastProvider`, which resets state each time. This has been
true since Increment A; nothing currently visibly broken by it (`ToastEffect`'s fire-once ref
resets along with the remount, but since each page only ever fires its own toast once anyway,
there's no user-visible symptom) — but it means `AppShell` is not actually a "persistent"
shell in the React sense, only visually consistent frame-to-frame. Fixing the loading-state
gap the right way (moving `AppShell` into a real `layout.tsx`) fixes this for real, as a side
effect, not as separate scope.

**Also folded in** (same category of gap, found adjacent to this work): the app already calls
Next's `notFound()` in 4 places (`billing/[id]`, `clients/[id]`, `providers/[id]`,
`visits/[id]/log`) with zero `not-found.tsx` anywhere, so all 4 currently render Next's default
unstyled 404. Confirmed in scope with the user rather than silently expanded.

## Architecture

New route group `apps/ops-console/app/(app)/` — parenthesized segments are invisible in the
URL, so moving routes into it changes no path. All ~15 staff-gated route folders move under
it: `billing/`, `clients/`, `dashboard/`, `exceptions/`, `providers/`, `roster/`, `staff/`,
`visits/`. `login/`, `not-authorized/`, and root `page.tsx` (a bare `requireStaffUser()` +
`redirect("/dashboard")`, no content of its own) stay where they are — none render `AppShell`
today, none benefit from moving.

`app/(app)/layout.tsx` (new, async server component): calls `requireStaffUser()` once, renders
`<AppShell user={staffUser}>{children}</AppShell>`. Every moved `page.tsx` drops its own
`<AppShell>...</AppShell>` wrapper and returns its inner content directly (a `<>...</>`
fragment or the same top-level element it already builds, just no longer wrapped).

### Two snags, resolved

**Toast.** 3 pages (`billing/[id]`, `roster`, `visits/log`) pass a `toast` prop to `AppShell`,
computed from their own `searchParams` (e.g. "Payment request sent."). `layout.tsx` has no
access to a page's `searchParams`. Fix: `AppShell`'s internal `ToastEffect` function component
becomes a named export (`export function ToastEffect(...)`), and `AppShell` itself drops its
`toast` prop entirely — it only renders `<ToastProvider>{children}</ToastProvider>` plus the
nav/header chrome now, no toast-firing logic of its own. The 3 pages that need a toast render
`<ToastEffect toast={...} />` as an ordinary child in their own JSX (anywhere inside what
becomes `{children}`) — this still works because React context (`ToastProvider`, established
by `AppShell` in the layout) flows to all descendants regardless of which file renders the
JSX, not just direct children of the provider's own file.

**Role logic.** 2 pages (`exceptions`, `providers/[id]`) read `staffUser.roleSlug` for their
own business logic (`canResolveCritical`, `isApprover`), not just to hand to `AppShell`. They
keep their own `requireStaffUser()` call in addition to the layout's — a redundant auth+role
query on those 2 routes specifically. Not solved with a shared context/hook: only 2 of ~15
routes need it, and adding a new cross-cutting mechanism for 2 call sites is exactly the
premature abstraction CLAUDE.md's working instructions say to avoid. Accepted as-is.

### New files

- `app/(app)/loading.tsx` — a simple centered pulse skeleton (`animate-pulse`, no new
  `@carebridge/ui` component — matches this app's existing plain-`<div>` styling precedent
  rather than introducing a `Skeleton` component for one use site). Renders inside the
  already-mounted `layout.tsx` (confirmed via Next.js's own composition model: a segment's
  `loading.tsx` wraps that segment's `page.tsx` in a `Suspense` boundary, but the segment's
  `layout.tsx` itself is not inside that boundary — it must resolve first, which `AppShell`
  does near-instantly since `requireStaffUser()` is a fast auth check), so the sidebar is
  visible throughout.
- `app/(app)/error.tsx` — must be a Client Component (Next.js requirement for `error.tsx`
  boundaries). Friendly message, a "Try again" button calling the `reset()` prop Next.js
  passes in, and a link back to `/dashboard`. Nav-preserved for the same reason as
  `loading.tsx` — this boundary wraps `page.tsx` and everything below it in the segment, not
  the segment's own `layout.tsx`, so a throw inside a page (the actual bug class D2 hit once:
  a plain `export const` in a `"use server"` file 500'd every request) is exactly what this
  catches, styled, with a way back.
- `app/(app)/not-found.tsx` — same visual treatment as `error.tsx` (friendly message, link
  back to `/dashboard`), catches all 4 existing `notFound()` call sites since they're all
  inside the `(app)` group.
- `app/error.tsx` (root, outside the group) — bare, no nav (can't preserve chrome that hasn't
  mounted yet by definition) — last-resort net for a failure before `(app)/layout.tsx` itself
  resolves (e.g. a Supabase client construction failure). Styled consistently with
  `not-authorized/page.tsx`'s existing bare `<main>` treatment, not a new visual language.
- `app/not-found.tsx` (root) — bare, same reasoning: catches a genuinely unmatched URL (a typo,
  not a `notFound()` call from inside a real route), which by definition isn't inside any
  specific segment's tree.

## Verification plan

Same bar as prior increments — real local Postgres, browser-driven, not just typechecked:

1. Confirm every moved route still resolves at its original URL (spot-check one per top-level
   directory: `/billing`, `/billing/[id]`, `/clients/new`, `/dashboard`, `/exceptions`,
   `/providers`, `/roster`, `/roster/coverage`, `/staff/invite`, `/visits/new`, `/visits/log`).
2. Confirm the nav sidebar is genuinely persistent now: use the browser's network throttling
   (or a temporary artificial delay in one page's data fetch) to observe `loading.tsx`'s
   skeleton rendering *inside* the sidebar, not replacing it.
3. Confirm the 3 toast-firing pages (`billing/[id]` after sending a payment request, `roster`
   after adding an assignment, `visits/log` after logging an outcome) still show their toast
   correctly after the `ToastEffect` extraction.
4. Confirm `exceptions` and `providers/[id]`'s role-gated UI (critical-resolver restriction,
   override approver gating) still works — these routes now call `requireStaffUser()` twice
   per request; confirm no double-redirect or other visible glitch.
5. Trigger a real `notFound()` (navigate to `/billing/00000000-0000-0000-0000-000000000000`,
   a syntactically valid but non-existent id) and confirm the styled `(app)/not-found.tsx`
   renders with the sidebar intact, not Next's default 404.
6. Trigger a real unmatched URL (`/this-route-does-not-exist`) and confirm the bare root
   `not-found.tsx` renders (no sidebar expected here — nothing authenticated this request).
7. Trigger a real thrown error inside a page (temporarily throw in one page's server component
   during verification only, reverted after) and confirm `(app)/error.tsx` renders with the
   sidebar intact and a working "Try again" button.
8. `pnpm --filter ops-console typecheck` and `lint` clean.

## Out of scope

- Any new `@carebridge/ui` component (Skeleton, ErrorBoundary wrapper) — the two new files
  are simple enough not to warrant one, matches this app's existing "plain div" precedent for
  one-off layout chrome (e.g. the roster coverage board's zone cards).
- A shared `staffUser` context/hook to avoid `exceptions`/`providers/[id]`'s duplicate
  `requireStaffUser()` call — 2 call sites don't justify a new cross-cutting mechanism.
- Moving root `/`, `login`, or `not-authorized` into the route group — none render `AppShell`,
  none benefit.
- Any change to `AppShell`'s nav items, styling, or the sign-out flow — this increment only
  relocates where `AppShell` is invoked and removes its `toast` prop.
