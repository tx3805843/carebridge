# Loading/Error/Not-Found States (Increment D5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every staff route in `ops-console` gets real `loading.tsx`/`error.tsx`/`not-found.tsx`
coverage with the persistent nav sidebar intact throughout — not a bare screen. `AppShell`
moves from being called fresh inside each of ~15 `page.tsx` files into a single
`app/(app)/layout.tsx`, which also fixes a latent bug where `AppShell` (and its
`ToastProvider`) fully remounted on every navigation.

**Architecture:** New route group `apps/ops-console/app/(app)/` (invisible in URLs) holds a
shared `layout.tsx` (calls `requireStaffUser()`, renders `AppShell`), `loading.tsx`,
`error.tsx`, and `not-found.tsx`. All ~15 staff-gated route folders move into it via `git mv`.
Every moved `page.tsx` drops its own `<AppShell>` wrapper. `AppShell`'s `toast` prop is
removed; its internal `ToastEffect` becomes an exported component that the 4 pages needing a
per-page toast render directly in their own JSX instead. 2 pages (`exceptions`,
`providers/[id]`) keep their own `requireStaffUser()` call since they use `staffUser.roleSlug`
for their own logic, not just display. Root-level `app/error.tsx` and `app/not-found.tsx`
(bare, no nav) cover failures before the layout itself mounts. `login`, `not-authorized`, and
root `page.tsx` stay outside the group — none render `AppShell` today.

**Tech Stack:** Next.js App Router (route groups, `loading.tsx`/`error.tsx`/`not-found.tsx`
special files), Supabase JS client, plain TypeScript. No test runner exists for `ops-console`
— verification is `typecheck`/`lint` plus a real browser walkthrough, matching every prior
increment.

**Spec:** `docs/superpowers/specs/2026-08-12-loading-error-states-d5-design.md`

**A note on mechanics:** most of this plan's file changes are a uniform, mechanical
transformation (move a file, delete its `AppShell` import, replace its `<AppShell>`/
`</AppShell>` wrapper with a Fragment `<>`/`</>` since every page has 2+ top-level children —
`<>` occupies the same structural position `<AppShell>` did, so its children keep their
*original* indentation, no dedent needed) applied to many files. Steps below give exact,
content-anchored `sed` deletions/substitutions (safe regardless of line number, since they
match on unique literal text) — Task 2's original steps included an incorrect dedent
instruction, caught and corrected after the fact; see that task's own note.
`sed -i ''` syntax below is macOS/BSD sed (empty string after `-i` for no backup file) —
confirm your environment before running; GNU
sed (Linux) omits the empty string argument.

---

### Task 1: New shared route-tree files

**Files:**
- Create: `apps/ops-console/app/(app)/layout.tsx`
- Create: `apps/ops-console/app/(app)/loading.tsx`
- Create: `apps/ops-console/app/(app)/error.tsx`
- Create: `apps/ops-console/app/(app)/not-found.tsx`
- Create: `apps/ops-console/app/error.tsx`
- Create: `apps/ops-console/app/not-found.tsx`

These are all self-contained — no existing file is touched, and nothing else in the app
depends on them existing yet (the route group has no pages in it until Task 2/3/4 move them
in, which is fine: an empty route group with a layout is harmless).

- [ ] **Step 1: `app/(app)/layout.tsx`**

```tsx
import { requireStaffUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staffUser = await requireStaffUser();

  return <AppShell user={staffUser}>{children}</AppShell>;
}
```

- [ ] **Step 2: `app/(app)/loading.tsx`**

```tsx
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-32 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-32 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}
```

- [ ] **Step 3: `app/(app)/error.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@carebridge/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        An unexpected error occurred loading this page. You can try again, or head back to the
        dashboard.
      </p>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `app/(app)/not-found.tsx`**

```tsx
import Link from "next/link";
import { buttonVariants } from "@carebridge/ui";

export default function AppNotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        The page or record you&apos;re looking for doesn&apos;t exist, or may have been removed.
      </p>
      <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
        Back to dashboard
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: `app/error.tsx`** (root — bare, no nav; catches failures before `(app)/layout.tsx` mounts)

```tsx
"use client";

import { useEffect } from "react";
import { Button } from "@carebridge/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-24">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">An unexpected error occurred. Please try again.</p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
```

- [ ] **Step 6: `app/not-found.tsx`** (root — bare, no nav; catches a genuinely unmatched URL)

```tsx
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-24">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist.</p>
    </main>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/ops-console/app/\(app\)/layout.tsx apps/ops-console/app/\(app\)/loading.tsx \
        apps/ops-console/app/\(app\)/error.tsx apps/ops-console/app/\(app\)/not-found.tsx \
        apps/ops-console/app/error.tsx apps/ops-console/app/not-found.tsx
git commit -m "D5: add app/(app) layout + loading/error/not-found states"
```

---

### Task 2: Move + strip 6 plain routes (batch A)

"Plain" = no `toast` prop today, `staffUser` used only for the `<AppShell user={staffUser}>`
prop (nowhere else in the file). **Every one of these pages has 2+ top-level JSX children
inside `<AppShell>...</AppShell>`** (e.g. a `<PageHeader>` plus a form) — simply deleting the
wrapper tags would leave invalid JSX (multiple root elements in one `return`). Instead, the
opening/closing tags are *replaced* with a Fragment (`<>`/`</>`), not deleted, so the existing
children keep exactly one root wrapper.

**Post-execution correction (leave this note for anyone re-reading the plan):** the steps
below, as originally written, included a "dedent the block between the tags by one level"
instruction, on the mistaken assumption that removing `<AppShell>` also removes a nesting
level. It doesn't — `<>` occupies the exact same structural position `<AppShell>` did, so its
children need to stay at their *original* indentation, one level deeper than `<>` itself. This
was caught by code review after Task 2 actually ran, and the resulting over-dedented
indentation in all 6 files below was corrected by hand afterward (commit `099a6bf`) rather
than by re-running a fixed version of these steps. The dedent line numbers quoted in each step
heading below are historical (they describe what was originally, incorrectly, done) — do not
re-run them. Task 3 was corrected in the plan itself before execution and never had this bug.

For each file: `git mv` into `(app)/`, remove the `AppShell` import, the `requireStaffUser`
import, and the `staffUser` assignment (content-anchored `sed` deletions, line-number-safe),
then replace the two `<AppShell>`/`</AppShell>` lines with `<>`/`</>` (content-anchored `sed`
substitutions, same safety property) — **no dedent step**.

**Files:**
- Move: `apps/ops-console/app/billing/new/page.tsx` → `apps/ops-console/app/(app)/billing/new/page.tsx`
- Move: `apps/ops-console/app/billing/page.tsx` → `apps/ops-console/app/(app)/billing/page.tsx`
- Move: `apps/ops-console/app/clients/new/page.tsx` → `apps/ops-console/app/(app)/clients/new/page.tsx`
- Move: `apps/ops-console/app/clients/[id]/page.tsx` → `apps/ops-console/app/(app)/clients/[id]/page.tsx`
- Move: `apps/ops-console/app/dashboard/page.tsx` → `apps/ops-console/app/(app)/dashboard/page.tsx`
- Move: `apps/ops-console/app/providers/new/page.tsx` → `apps/ops-console/app/(app)/providers/new/page.tsx`

- [ ] **Step 1: `billing/new/page.tsx`** (original opening tag line 19, closing line 25 — dedent range 20-24)

```bash
git mv "apps/ops-console/app/billing/new/page.tsx" "apps/ops-console/app/(app)/billing/new/page.tsx"
F="apps/ops-console/app/(app)/billing/new/page.tsx"
sed -i '' '20,24s/^  //' "$F"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 2: `billing/page.tsx`** (opening line 131, closing line 190 — dedent range 132-189)

```bash
git mv "apps/ops-console/app/billing/page.tsx" "apps/ops-console/app/(app)/billing/page.tsx"
F="apps/ops-console/app/(app)/billing/page.tsx"
sed -i '' '132,189s/^  //' "$F"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 3: `clients/new/page.tsx`** (opening line 20, closing line 31 — dedent range 21-30)

```bash
git mv "apps/ops-console/app/clients/new/page.tsx" "apps/ops-console/app/(app)/clients/new/page.tsx"
F="apps/ops-console/app/(app)/clients/new/page.tsx"
sed -i '' '21,30s/^  //' "$F"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 4: `clients/[id]/page.tsx`** (opening line 79, closing line 305 — dedent range 80-304)

```bash
git mv "apps/ops-console/app/clients/[id]/page.tsx" "apps/ops-console/app/(app)/clients/[id]/page.tsx"
F="apps/ops-console/app/(app)/clients/[id]/page.tsx"
sed -i '' '80,304s/^  //' "$F"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 5: `dashboard/page.tsx`** (opening line 72, closing line 126 — dedent range 73-125)

```bash
git mv "apps/ops-console/app/dashboard/page.tsx" "apps/ops-console/app/(app)/dashboard/page.tsx"
F="apps/ops-console/app/(app)/dashboard/page.tsx"
sed -i '' '73,125s/^  //' "$F"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 6: `providers/new/page.tsx`** (opening line 35, closing line 38 — dedent range 36-37)

```bash
git mv "apps/ops-console/app/providers/new/page.tsx" "apps/ops-console/app/(app)/providers/new/page.tsx"
F="apps/ops-console/app/(app)/providers/new/page.tsx"
sed -i '' '36,37s/^  //' "$F"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 7: Read each of the 6 files after editing** to confirm: the `<AppShell...>`/
      `</AppShell>` lines became `<>`/`</>` (not deleted outright — every one of these files
      has 2+ top-level children, so a bare deletion would leave invalid JSX), no leftover
      blank-line oddities that look wrong, no stray indentation making the `return (` block
      look broken, and no reference to `AppShell`, `requireStaffUser`, or `staffUser` remains
      anywhere in any of the 6 files.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 9: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/ops-console/app/billing apps/ops-console/app/clients apps/ops-console/app/dashboard \
        apps/ops-console/app/providers/new "apps/ops-console/app/(app)"
git commit -m "D5: move 6 routes into app/(app), strip per-page AppShell (batch A)"
```

(The `git add` above stages both the old-path deletions and new-path additions git detects as
the same move; if `git status` shows anything unexpected — e.g. a file not renamed cleanly —
stop and report rather than force-adding blindly.)

---

### Task 3: Move + strip 6 more routes (batch B, including the one special case)

Same recipe as Task 2 for 5 of these — **except no dedent step**. Task 2's own execution found
a real bug in the original recipe: `<>` occupies the exact same structural position
`<AppShell>` did (still a real wrapping element), so its children must stay at their
*original* indentation, one level deeper than `<>` itself — dedenting them was wrong and has
already been reverted across all 6 Task 2 files. Do not dedent anything in this task; only
`git mv`, remove the 3 now-unused lines (content-anchored, line-number-safe), and replace the
two wrapper tags with `<>`/`</>` in place.

The 6th, `providers/[id]/page.tsx`, is the one file where `staffUser` is used for more than
the `AppShell` prop (`isApprover` on line 165) — its recipe **keeps** the `requireStaffUser`
import and the `staffUser` assignment, only removing the `AppShell` import and replacing the
two wrapper tags with `<>`/`</>`.

**Also check for co-located sibling files.** Task 2 found that some route folders have
`actions.ts` and/or a form component the `page.tsx` imports via a relative path (`./actions`,
`./some-form`) — moving only `page.tsx` breaks those imports. Before moving each file below,
run `ls` on its current directory; if there are sibling files beyond `page.tsx`, move the
whole directory's contents together (`git mv` each sibling file too, into the same new path)
so relative imports keep resolving. Typecheck at the end of this task will catch anything
missed, but check proactively rather than relying on that alone.

**Files:**
- Move: `apps/ops-console/app/visits/[id]/log/page.tsx` → `apps/ops-console/app/(app)/visits/[id]/log/page.tsx`
- Move: `apps/ops-console/app/roster/coverage/page.tsx` → `apps/ops-console/app/(app)/roster/coverage/page.tsx`
- Move: `apps/ops-console/app/providers/page.tsx` → `apps/ops-console/app/(app)/providers/page.tsx`
- Move: `apps/ops-console/app/staff/invite/page.tsx` → `apps/ops-console/app/(app)/staff/invite/page.tsx`
- Move: `apps/ops-console/app/visits/new/page.tsx` → `apps/ops-console/app/(app)/visits/new/page.tsx`
- Move: `apps/ops-console/app/providers/[id]/page.tsx` → `apps/ops-console/app/(app)/providers/[id]/page.tsx`

- [ ] **Step 1: `visits/[id]/log/page.tsx`** (plus any sibling files in that directory)

```bash
git mv "apps/ops-console/app/visits/[id]/log/page.tsx" "apps/ops-console/app/(app)/visits/[id]/log/page.tsx"
F="apps/ops-console/app/(app)/visits/[id]/log/page.tsx"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 2: `roster/coverage/page.tsx`** (plus any sibling files in that directory)

```bash
git mv "apps/ops-console/app/roster/coverage/page.tsx" "apps/ops-console/app/(app)/roster/coverage/page.tsx"
F="apps/ops-console/app/(app)/roster/coverage/page.tsx"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 3: `providers/page.tsx`** (plus any sibling files in that directory)

```bash
git mv "apps/ops-console/app/providers/page.tsx" "apps/ops-console/app/(app)/providers/page.tsx"
F="apps/ops-console/app/(app)/providers/page.tsx"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 4: `staff/invite/page.tsx`** (plus any sibling files in that directory)

```bash
git mv "apps/ops-console/app/staff/invite/page.tsx" "apps/ops-console/app/(app)/staff/invite/page.tsx"
F="apps/ops-console/app/(app)/staff/invite/page.tsx"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 5: `visits/new/page.tsx`** (plus any sibling files in that directory)

```bash
git mv "apps/ops-console/app/visits/new/page.tsx" "apps/ops-console/app/(app)/visits/new/page.tsx"
F="apps/ops-console/app/(app)/visits/new/page.tsx"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' '/^import { requireStaffUser } from "@\/lib\/auth";$/d' "$F"
sed -i '' '/^  const staffUser = await requireStaffUser();$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

- [ ] **Step 6: `providers/[id]/page.tsx`** (plus any sibling files, e.g. `actions.ts`/
      `constants.ts`, in that directory) — SPECIAL CASE, keeps `requireStaffUser`/`staffUser`
      (used at `isApprover = staffUser.roleSlug === ...`). Only 3 edits here, not 5, and still
      no dedent:

```bash
git mv "apps/ops-console/app/providers/[id]/page.tsx" "apps/ops-console/app/(app)/providers/[id]/page.tsx"
F="apps/ops-console/app/(app)/providers/[id]/page.tsx"
sed -i '' '/^import { AppShell } from "@\/components\/app-shell";$/d' "$F"
sed -i '' 's/^    <AppShell user={staffUser}>$/    <>/' "$F"
sed -i '' 's/^    <\/AppShell>$/    <\/>/' "$F"
```

Confirm after this step that `apps/ops-console/lib/auth.ts`'s `requireStaffUser` import and
the `const staffUser = await requireStaffUser();` line are both **still present** in this one
file (they should be untouched — this step's `sed` commands never target them).

- [ ] **Step 7: Read each of the 6 files after editing**, same confirmation as Task 2 Step 7
      (well-formed JSX with children correctly indented one level deeper than `<>`/`</>`, no
      leftover `AppShell` references, no orphaned blank line where `const staffUser = ...` used
      to be). For `providers/[id]/page.tsx` specifically, confirm `requireStaffUser`/
      `staffUser` are exactly as they were before (only the `AppShell` import and its two
      wrapper tags changed) and that `isApprover`'s line is untouched.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 9: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/ops-console/app/visits apps/ops-console/app/roster/coverage \
        apps/ops-console/app/providers apps/ops-console/app/staff "apps/ops-console/app/(app)"
git commit -m "D5: move 6 routes into app/(app), strip per-page AppShell (batch B)"
```

---

### Task 4: `app-shell.tsx` toast-prop removal + the 4 toast-using pages

These 4 pages currently pass a `toast` prop to `<AppShell>`, computed from their own
`searchParams` — `layout.tsx` (Task 1) can't see that, so `AppShell` needs to stop accepting
`toast` at all, and each of these 4 pages needs to render the extracted `ToastEffect`
component directly in its own returned JSX instead. This is one task/commit because
`app-shell.tsx`'s prop-type change and these 4 pages' call sites must land together — landing
either half alone leaves the other half failing to typecheck.

**Files:**
- Modify: `apps/ops-console/components/app-shell.tsx`
- Move + modify: `apps/ops-console/app/billing/[id]/page.tsx` → `apps/ops-console/app/(app)/billing/[id]/page.tsx`
  (plus sibling `apps/ops-console/app/billing/[id]/actions.ts` — `git mv` unmodified)
- Move + modify: `apps/ops-console/app/roster/page.tsx` → `apps/ops-console/app/(app)/roster/page.tsx`
  (plus siblings `apps/ops-console/app/roster/actions.ts` and
  `apps/ops-console/app/roster/roster-form.tsx` — `git mv` unmodified)
- Move + modify: `apps/ops-console/app/visits/log/page.tsx` → `apps/ops-console/app/(app)/visits/log/page.tsx`
  (no siblings — this directory contains only `page.tsx`)
- Move + modify: `apps/ops-console/app/exceptions/page.tsx` → `apps/ops-console/app/(app)/exceptions/page.tsx`
  (plus siblings `apps/ops-console/app/exceptions/actions.ts`, `constants.ts`, `utils.ts` —
  `git mv` unmodified)

(Confirmed by directly listing each directory before writing this plan section — Tasks 2/3
found this same sibling-file gap the hard way; it's accounted for here up front instead.)

- [ ] **Step 1: `app-shell.tsx` — drop the `toast` prop, export `ToastEffect`**

Current relevant section:

```tsx
export function AppShell({
  user,
  toast,
  children,
}: {
  user: { fullName: string; roleLabel: string };
  // Fires once on mount via ToastEffect below — for low-stakes confirmations only (see
  // components/toast.tsx's own doc comment on when NOT to use this).
  toast?: { message: string; variant?: ToastVariant };
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <ToastProvider>
      <ToastEffect toast={toast} />
      <div className="flex min-h-screen">
```

Replace with:

```tsx
export function AppShell({
  user,
  children,
}: {
  user: { fullName: string; roleLabel: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
```

And further down, change:

```tsx
function ToastEffect({ toast }: { toast?: { message: string; variant?: ToastVariant } }) {
```

to:

```tsx
export function ToastEffect({ toast }: { toast?: { message: string; variant?: ToastVariant } }) {
```

(Everything else in `app-shell.tsx` — the `NAV_ITEMS` array, the nav rendering, the header,
`ToastEffect`'s own body — is unchanged.)

- [ ] **Step 2: `billing/[id]/page.tsx`**

```bash
git mv "apps/ops-console/app/billing/[id]/page.tsx" "apps/ops-console/app/(app)/billing/[id]/page.tsx"
git mv "apps/ops-console/app/billing/[id]/actions.ts" "apps/ops-console/app/(app)/billing/[id]/actions.ts"
```

Change the import line:

```tsx
import { AppShell } from "@/components/app-shell";
```

to:

```tsx
import { ToastEffect } from "@/components/app-shell";
```

Change the `return (` block. Current:

```tsx
  return (
    <AppShell user={staffUser} toast={created ? { message: "Subscription created." } : undefined}>
      <EntitySummaryCard
```

to:

```tsx
  return (
    <>
      <ToastEffect toast={created ? { message: "Subscription created." } : undefined} />
      <EntitySummaryCard
```

And the closing tag. Current (last two lines of the function body):

```tsx
    </AppShell>
  );
}
```

to:

```tsx
    </>
  );
}
```

Also remove the now-unused `requireStaffUser` import and `const staffUser = await
requireStaffUser();` line (this page's `staffUser` was only ever used for the `AppShell`
prop — confirm this is still true after the edits above before deleting; it should be, since
`ToastEffect` doesn't need `staffUser`).

- [ ] **Step 3: `roster/page.tsx`**

```bash
git mv "apps/ops-console/app/roster/page.tsx" "apps/ops-console/app/(app)/roster/page.tsx"
git mv "apps/ops-console/app/roster/actions.ts" "apps/ops-console/app/(app)/roster/actions.ts"
git mv "apps/ops-console/app/roster/roster-form.tsx" "apps/ops-console/app/(app)/roster/roster-form.tsx"
```

Same pattern. Import line `import { AppShell } from "@/components/app-shell";` →
`import { ToastEffect } from "@/components/app-shell";`.

Current:

```tsx
  return (
    <AppShell user={staffUser} toast={added ? { message: "Roster assignment added." } : undefined}>
      <PageHeader
```

to:

```tsx
  return (
    <>
      <ToastEffect toast={added ? { message: "Roster assignment added." } : undefined} />
      <PageHeader
```

Closing tag: `    </AppShell>` (immediately before the function's final `);`/`}`) → `    </>`.

Remove the now-unused `requireStaffUser` import and `const staffUser = await
requireStaffUser();` line (same confirmation as Step 2 — `staffUser` here was only ever used
for the `AppShell` prop).

- [ ] **Step 4: `visits/log/page.tsx`**

```bash
git mv "apps/ops-console/app/visits/log/page.tsx" "apps/ops-console/app/(app)/visits/log/page.tsx"
```

Same pattern. Import line swap, same as Steps 2-3.

Current:

```tsx
  return (
    <AppShell user={staffUser} toast={logged ? { message: "Visit outcome logged." } : undefined}>
      <PageHeader title="Log a visit" />
```

to:

```tsx
  return (
    <>
      <ToastEffect toast={logged ? { message: "Visit outcome logged." } : undefined} />
      <PageHeader title="Log a visit" />
```

Closing tag: `    </AppShell>` → `    </>`.

Remove the now-unused `requireStaffUser` import and `const staffUser = await
requireStaffUser();` line (same confirmation as Steps 2-3).

- [ ] **Step 5: `exceptions/page.tsx`** — this one KEEPS `requireStaffUser`/`staffUser`
      (used for `canResolveCritical` at what was line 167). Only the `AppShell` import and the
      wrapper tags change.

```bash
git mv "apps/ops-console/app/exceptions/page.tsx" "apps/ops-console/app/(app)/exceptions/page.tsx"
git mv "apps/ops-console/app/exceptions/actions.ts" "apps/ops-console/app/(app)/exceptions/actions.ts"
git mv "apps/ops-console/app/exceptions/constants.ts" "apps/ops-console/app/(app)/exceptions/constants.ts"
git mv "apps/ops-console/app/exceptions/utils.ts" "apps/ops-console/app/(app)/exceptions/utils.ts"
```

Import line: `import { AppShell } from "@/components/app-shell";` →
`import { ToastEffect } from "@/components/app-shell";`.

Current (the multi-line opening tag):

```tsx
  return (
    <AppShell
      user={staffUser}
      toast={
        acknowledged
          ? { message: "Escalation acknowledged." }
          : assigned
            ? { message: "Case assigned." }
            : undefined
      }
    >
      <PageHeader
```

to:

```tsx
  return (
    <>
      <ToastEffect
        toast={
          acknowledged
            ? { message: "Escalation acknowledged." }
            : assigned
              ? { message: "Case assigned." }
              : undefined
        }
      />
      <PageHeader
```

Closing tag: `    </AppShell>` (immediately before the function's final `);`/`}`) → `    </>`.

Confirm `requireStaffUser`'s import and the `const staffUser = await requireStaffUser();` line
are both **still present and unchanged** — this file needs them for `canResolveCritical`.

- [ ] **Step 6: Read all 5 changed files** (`app-shell.tsx` plus the 4 pages) to confirm every
      JSX fragment is well-formed (`<>` has a matching `</>`, no stray `AppShell` references
      left anywhere in any of the 4 pages), and that `exceptions/page.tsx` still has its
      `requireStaffUser`/`staffUser`/`canResolveCritical` chain intact.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 8: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/ops-console/components/app-shell.tsx apps/ops-console/app/exceptions \
        apps/ops-console/app/billing apps/ops-console/app/roster apps/ops-console/app/visits \
        "apps/ops-console/app/(app)"
git commit -m "D5: extract ToastEffect from AppShell; move+fix the 4 toast-using routes"
```

---

### Task 5: Full typecheck/lint pass, confirm no route left outside `(app)`

**Files:** none (verification only)

- [ ] **Step 1: Confirm every staff route moved**

Run: `find apps/ops-console/app -maxdepth 1 -type d` — the only remaining top-level directories
under `apps/ops-console/app/` besides `(app)` should be `login`, `logout`, `not-authorized`.
If anything else is still there (a route that should have moved in Tasks 2-4 but didn't),
stop and fix it before proceeding — don't paper over a missed route.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter ops-console lint`
Expected: no errors.

- [ ] **Step 4: Fix and re-run if either fails**

Fix any reported issue in the file it names, re-run both until clean.

---

### Task 6: Verify in the browser against real local Postgres

**Files:** none (verification only)

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

- [ ] **Step 2: Confirm every moved route still resolves at its original URL**

Log in as `coordinator1@carebridge.dev` / `carebridge-dev-2026`. Visit each of: `/dashboard`,
`/exceptions`, `/clients/new`, `/billing`, `/billing/new`, `/roster`, `/roster/coverage`,
`/providers`, `/providers/new`, `/staff/invite`, `/visits/new`, `/visits/log`. Confirm each
renders its normal content with the sidebar visible (same nav items as before this increment,
same active-route highlighting).

- [ ] **Step 3: Confirm a detail route with real data** (proves the route-group move didn't
      break dynamic segments)

Visit a real client detail (`/clients/[id]` for any seeded client), a real provider detail
(`/providers/[id]` for any seeded provider — this is the special-case file, confirm its
credential/verification-override UI, including the `isApprover`-gated override actions, still
render correctly for a `clinical_director`/`admin` login), and a real billing detail
(`/billing/[id]` for any seeded subscription).

- [ ] **Step 4: Confirm the nav sidebar is genuinely persistent now (the actual point of this increment)**

Using devtools' Network tab, throttle to "Slow 3G" (or similar), then navigate between two
different routes (e.g. `/dashboard` → `/billing`). Confirm the sidebar does **not** disappear
or flash during the transition — the `loading.tsx` skeleton should appear only in the content
area to the right of the sidebar, which stays visibly mounted throughout. Restore normal
network speed afterward.

- [ ] **Step 5: Confirm all 4 toast-firing routes still show their toast correctly**

- `/billing/[id]`: send a payment request on a draft invoice (or create one first if none
  exists), confirm "Payment request sent." toast fires. (Use a fresh draft on a subscription
  with no in-flight payment, matching D4's own verified flow.)
- `/roster`: add a roster assignment, confirm "Roster assignment added." toast fires.
- `/visits/log` → visit outcome log: log a visit outcome, confirm "Visit outcome logged." toast
  fires on redirect back.
- `/exceptions`: acknowledge or assign an open escalation, confirm the corresponding toast
  fires.

- [ ] **Step 6: Confirm `exceptions` and `providers/[id]`'s role-gated logic still works**

Log in as a `clinical_director`/`admin` account, confirm `providers/[id]`'s override-approval
actions are visible (matching D2's already-verified behavior). Log in as `coordinator1` (a
plain coordinator), confirm the exception queue's critical-case resolution is still correctly
blocked for a non-`clinical_director`/`admin` role (matching the exception queue's existing
governed-resolution behavior from Increment A cont'd) — proves the duplicate
`requireStaffUser()` call in these 2 files still functions correctly post-move.

- [ ] **Step 7: Trigger the styled 404** (`(app)/not-found.tsx`)

Navigate to `/billing/00000000-0000-0000-0000-000000000000` (syntactically valid, non-existent
id — triggers the existing `notFound()` call in that page). Confirm the styled not-found page
renders **with the sidebar intact**, not Next's default 404. Repeat for one more of the 3
other `notFound()` call sites (`/clients/[id]`, `/providers/[id]`, or
`/visits/[id]/log`) with a similarly bogus id, to confirm the shared `(app)/not-found.tsx`
catches all of them, not just one.

- [ ] **Step 8: Trigger the bare root 404**

Navigate to a URL that matches no route at all, e.g. `/this-route-does-not-exist`. Confirm the
bare root `not-found.tsx` renders (no sidebar — correct, since nothing under `(app)` matched).

- [ ] **Step 9: Trigger the styled error boundary** (`(app)/error.tsx`)

Temporarily introduce a real throw in one page's server component body (e.g. add `throw new
Error("D5 verification test");` as the first line inside `/dashboard`'s page function),
reload `/dashboard`, confirm `(app)/error.tsx` renders **with the sidebar intact**, the error
message is friendly (not a raw stack trace), and clicking "Try again" successfully re-renders
the page. Revert the temporary throw immediately after confirming — do not leave it in.

- [ ] **Step 10: Clean up**

Confirm the temporary throw from Step 9 is fully reverted (`git diff` should show nothing
uncommitted). Stop the dev server. `supabase stop`.

No permanent code changes in this task beyond what Tasks 1-4 already committed. If any step's
actual result doesn't match what's described, do not patch ad hoc — report exactly what
happened so the relevant task above can be fixed.

---

### Task 7: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Check off the "loading/error states" gap story**

Find the line (currently unchecked, in the "Ops Console UX Refresh" epic's checklist, logged
when D4 closed):

```
  - [ ] New (found closing D4): add `loading.tsx`/`error.tsx` to `ops-console`'s priority routes — no route has either today.
```

Replace with a checked line summarizing what was actually built and verified, in this file's
established style. Record at minimum: `AppShell` moved from being called per-page into a real
`app/(app)/layout.tsx` (~15 routes moved via `git mv`), which also fixed a latent bug where
`AppShell`/`ToastProvider` fully remounted on every navigation; `loading.tsx`/`error.tsx` at
the `(app)` level render with the nav sidebar intact (verified via network throttling, not
just visually assumed); `not-found.tsx` folded in as an adjacent, user-confirmed scope
addition, covering the app's existing 4 `notFound()` call sites; root-level bare
`error.tsx`/`not-found.tsx` cover failures before the layout mounts; `AppShell`'s `toast` prop
was removed in favor of an exported `ToastEffect` the 4 toast-using pages render directly
(confirmed all 4 still fire correctly); 2 pages (`exceptions`, `providers/[id]`) keep a
second, duplicate `requireStaffUser()` call for their own role-gated logic — a deliberate
YAGNI call, not a missed cleanup.

- [ ] **Step 2: Update the "Last updated" summary line**

Update the top summary line to reflect this story is done and name whichever of the 2
remaining gap stories (accessibility acceptance-test pass; regenerate user-guide screenshots)
is next, per the user's own stated sequencing ("let me know when we can tackle" the other
two) — do not silently start either of those without checking in first, per that instruction.

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close loading/error/not-found states gap story"
```
