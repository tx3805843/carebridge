# Consent & Authority Management (Increment B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client detail page (`/clients/[id]`) that manages `authority_grant`
(decision-maker/payer/escort) and `consent_grant` (health-update/photography) grants per
sponsor, plus `consent_record` (signed client consent), with real Grant/Revoke actions
against B0's already-designed tables.

**Architecture:** One new server-component page mirroring the existing `/providers/[id]`
pattern exactly (`EntitySummaryCard` header, `DataTable` for list content, one bound server
action per form), a new `actions.ts` with five actions, and a one-line link upgrade on the
onboarding-success message (the only navigation path to the new page — no clients list page
exists or is built here). No schema changes, no RLS changes — every table this touches
already has staff-write policies from Domain 1/9 and B0.

**Tech Stack:** Next.js App Router server components + server actions, `@carebridge/ui`
(`EntitySummaryCard`, `DataTable`, `StatusBadge`, `ConfirmSubmitButton`, `Button`), Supabase
JS client. No test framework in this repo for this layer — verified via
`typecheck`/`lint` + real browser-driven testing against local Postgres, same as every prior
increment this session.

**Spec:** `docs/superpowers/specs/2026-08-10-consent-authority-b2-design.md`

---

### Task 1: Constants shared by the new page and actions

**Files:**
- Create: `apps/ops-console/app/clients/[id]/constants.ts`

- [ ] **Step 1: Write the file**

```typescript
// authority_grant.authority_type values this page manages — matches the check constraint in
// supabase/migrations/20260810070000_family_authority_grants.sql exactly.
export const AUTHORITY_TYPES = [
  { value: "decision_maker", label: "Decision-maker authority" },
  { value: "billing_responsible", label: "Payer authority" },
  { value: "escort", label: "Escort authority" },
] as const;

// consent_grant.scope values this page manages. 'billing' and 'location_tracking' are not
// managed here — 'billing' access is now authority_grant-driven (see ADR-0005),
// 'location_tracking' has no UI anywhere yet and is out of this increment's scope.
export const CONSENT_SCOPES = [
  { value: "clinical_detail", label: "Health-update authority" },
  { value: "photos", label: "Photography & document consent" },
] as const;

export type AuthorityTypeValue = (typeof AUTHORITY_TYPES)[number]["value"];
export type ConsentScopeValue = (typeof CONSENT_SCOPES)[number]["value"];
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: exits 0 (this file has no consumers yet, so this just confirms the file itself is
valid TypeScript).

- [ ] **Step 3: Commit**

```bash
git add "apps/ops-console/app/clients/[id]/constants.ts"
git commit -m "Increment B2: authority/consent constants for client detail page"
```

---

### Task 2: Server actions

**Files:**
- Create: `apps/ops-console/app/clients/[id]/actions.ts`

- [ ] **Step 1: Write the file**

```typescript
"use server";

import { redirect } from "next/navigation";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AUTHORITY_TYPES, CONSENT_SCOPES } from "./constants";

const AUTHORITY_TYPE_VALUES = new Set<string>(AUTHORITY_TYPES.map((type) => type.value));
const CONSENT_SCOPE_VALUES = new Set<string>(CONSENT_SCOPES.map((scope) => scope.value));

export async function grantAuthority(clientId: string, formData: FormData) {
  const sponsorId = String(formData.get("sponsorId") ?? "");
  const authorityType = String(formData.get("authorityType") ?? "");
  const evidenceDocumentRef = String(formData.get("evidenceDocumentRef") ?? "").trim();
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "");
  const effectiveUntil = String(formData.get("effectiveUntil") ?? "");

  if (!sponsorId || !AUTHORITY_TYPE_VALUES.has(authorityType)) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("A sponsor and valid authority type are required.")}`);
  }

  const staffUser = await requireStaffUser();
  const supabase = await createClient();

  const { error } = await supabase.from("authority_grant").insert({
    client_id: clientId,
    sponsor_id: sponsorId,
    authority_type: authorityType,
    status: "active",
    evidence_document_ref: evidenceDocumentRef || null,
    effective_from: effectiveFrom || null,
    effective_until: effectiveUntil || null,
    granted_at: new Date().toISOString(),
    granted_by: staffUser.id,
  });

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=authority`);
}

export async function revokeAuthority(clientId: string, formData: FormData) {
  const authorityGrantId = String(formData.get("authorityGrantId") ?? "");

  if (!authorityGrantId) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Missing authority grant.")}`);
  }

  const staffUser = await requireStaffUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("authority_grant")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: staffUser.id })
    .eq("id", authorityGrantId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=authority`);
}

export async function grantConsent(clientId: string, formData: FormData) {
  const sponsorId = String(formData.get("sponsorId") ?? "");
  const scope = String(formData.get("scope") ?? "");

  if (!sponsorId || !CONSENT_SCOPE_VALUES.has(scope)) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("A sponsor and valid consent scope are required.")}`);
  }

  const supabase = await createClient();

  const { data: sponsor } = await supabase.from("family_sponsor").select("user_id").eq("id", sponsorId).maybeSingle();

  if (!sponsor) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Sponsor not found.")}`);
  }

  // consent_grant's active-row uniqueness is a PARTIAL unique index
  // (client_id, grantee_user_id, scope) where revoked_at is null (see
  // 20260809160000_domain1_identity_access.sql). supabase-js's upsert() generates a plain
  // `ON CONFLICT (columns)` clause with no WHERE predicate, which Postgres rejects as not
  // matching a partial index — so this is a plain existence-check-then-insert, not an upsert.
  // A prior revoked row for the same (client, grantee, scope) is left untouched as audit
  // history; only a fresh, unrevoked row is ever inserted.
  const { data: existing } = await supabase
    .from("consent_grant")
    .select("id")
    .eq("client_id", clientId)
    .eq("grantee_user_id", sponsor.user_id)
    .eq("scope", scope)
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) {
    redirect(`/clients/${clientId}?updated=consent`);
  }

  const { error } = await supabase.from("consent_grant").insert({
    client_id: clientId,
    grantee_user_id: sponsor.user_id,
    scope,
    granted_at: new Date().toISOString(),
  });

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=consent`);
}

export async function revokeConsent(clientId: string, formData: FormData) {
  const consentGrantId = String(formData.get("consentGrantId") ?? "");

  if (!consentGrantId) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Missing consent grant.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("consent_grant")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", consentGrantId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=consent`);
}

export async function recordConsent(clientId: string, formData: FormData) {
  const documentRef = String(formData.get("documentRef") ?? "").trim();
  const signedAt = String(formData.get("signedAt") ?? "");

  if (!documentRef) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("A document reference is required.")}`);
  }

  const supabase = await createClient();

  const { error } = await supabase.from("consent_record").insert({
    client_id: clientId,
    document_ref: documentRef,
    signed_at: signedAt || undefined,
  });

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?updated=consent-record`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ops-console typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops-console/app/clients/[id]/actions.ts"
git commit -m "Increment B2: grant/revoke server actions for authority_grant/consent_grant/consent_record"
```

---

### Task 3: Client detail page

**Files:**
- Create: `apps/ops-console/app/clients/[id]/page.tsx`

- [ ] **Step 1: Write the file**

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, ConfirmSubmitButton, DataTable, EntitySummaryCard, StatusBadge } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { grantAuthority, revokeAuthority, grantConsent, revokeConsent, recordConsent } from "./actions";
import { AUTHORITY_TYPES, CONSENT_SCOPES } from "./constants";

interface ConsentRecordRow {
  id: string;
  document_ref: string;
  signed_at: string;
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; updated?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { id } = await params;
  const { error, updated } = await searchParams;

  const supabase = await createClient();

  const { data: client } = await supabase
    .from("client")
    .select("id, full_name, date_of_birth, zone_id")
    .eq("id", id)
    .maybeSingle();

  if (!client) {
    notFound();
  }

  const [{ data: zone }, { data: sponsors }, { data: authorityGrants }, { data: consentRecords }] = await Promise.all([
    supabase.from("zone").select("name").eq("id", client.zone_id).maybeSingle(),
    supabase.from("family_sponsor").select("id, user_id, relationship").eq("client_id", client.id),
    supabase
      .from("authority_grant")
      .select("id, sponsor_id, authority_type, status, evidence_document_ref, effective_from, effective_until")
      .eq("client_id", client.id),
    supabase
      .from("consent_record")
      .select("id, document_ref, signed_at")
      .eq("client_id", client.id)
      .order("signed_at", { ascending: false }),
  ]);

  const sponsorUserIds = (sponsors ?? []).map((sponsor) => sponsor.user_id);

  const [{ data: sponsorUsers }, { data: consentGrants }] = await Promise.all([
    sponsorUserIds.length > 0
      ? supabase.from("user").select("id, full_name, email").in("id", sponsorUserIds)
      : Promise.resolve({ data: [] }),
    sponsorUserIds.length > 0
      ? supabase
          .from("consent_grant")
          .select("id, grantee_user_id, scope, granted_at, revoked_at")
          .eq("client_id", client.id)
          .in("grantee_user_id", sponsorUserIds)
      : Promise.resolve({ data: [] }),
  ]);

  const sponsorUserById = new Map((sponsorUsers ?? []).map((user) => [user.id, user]));

  return (
    <AppShell user={staffUser}>
      <EntitySummaryCard
        title={client.full_name}
        subtitle={zone?.name ?? "No zone"}
        meta={[{ label: "DOB", value: formatDate(client.date_of_birth) }]}
      />

      {updated ? <p className="mb-4 text-sm text-success">Updated.</p> : null}
      {error ? <p className="mb-4 text-sm text-critical">{error}</p> : null}

      <div className="flex flex-col gap-10">
        <section className="flex w-full max-w-2xl flex-col gap-3">
          <h2 className="text-lg font-medium">Client consent to receive care</h2>
          <DataTable<ConsentRecordRow>
            rows={consentRecords ?? []}
            rowKey={(row) => row.id}
            emptyMessage="No signed consent recorded yet."
            columns={[
              { key: "document", header: "Document", render: (row) => row.document_ref },
              { key: "signed", header: "Signed", render: (row) => formatDate(row.signed_at) },
            ]}
          />
          <form
            action={recordConsent.bind(null, client.id)}
            className="flex flex-wrap items-end gap-2 rounded-md border border-border p-4"
          >
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Document ref
              <input name="documentRef" required className="rounded-md border border-border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Signed at
              <input type="date" name="signedAt" className="rounded-md border border-border px-3 py-2" />
            </label>
            <Button type="submit" size="sm">
              Record consent
            </Button>
          </form>
        </section>

        <section className="flex w-full max-w-3xl flex-col gap-6">
          <h2 className="text-lg font-medium">Family sponsors & authority</h2>
          {(sponsors ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No sponsors linked yet.</p>
          ) : (
            (sponsors ?? []).map((sponsor) => {
              const sponsorUser = sponsorUserById.get(sponsor.user_id);

              return (
                <div key={sponsor.id} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
                  <div>
                    <p className="font-medium">{sponsorUser?.full_name ?? "Unknown sponsor"}</p>
                    <p className="text-sm text-muted-foreground">
                      {sponsor.relationship} · {sponsorUser?.email ?? "no email"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    {AUTHORITY_TYPES.map((type) => {
                      const activeGrant = (authorityGrants ?? []).find(
                        (grant) =>
                          grant.sponsor_id === sponsor.id && grant.authority_type === type.value && grant.status === "active",
                      );
                      const pendingGrant = (authorityGrants ?? []).find(
                        (grant) =>
                          grant.sponsor_id === sponsor.id && grant.authority_type === type.value && grant.status === "pending",
                      );
                      const badge = activeGrant
                        ? ({ variant: "success", label: "Captured" } as const)
                        : pendingGrant
                          ? ({ variant: "warning", label: "Needs review" } as const)
                          : ({ variant: "neutral", label: "Not granted" } as const);

                      return (
                        <div
                          key={type.value}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{type.label}</span>
                            <StatusBadge variant={badge.variant} label={badge.label} />
                            {activeGrant?.evidence_document_ref ? (
                              <span className="text-xs text-muted-foreground">
                                Evidence: {activeGrant.evidence_document_ref}
                              </span>
                            ) : null}
                          </div>
                          {activeGrant ? (
                            <form action={revokeAuthority.bind(null, client.id)}>
                              <input type="hidden" name="authorityGrantId" value={activeGrant.id} />
                              <ConfirmSubmitButton
                                size="sm"
                                variant="destructive"
                                confirmTitle="Revoke this authority?"
                                confirmDescription={
                                  <>
                                    This revokes <strong>{type.label}</strong> for{" "}
                                    <strong>{sponsorUser?.full_name ?? "this sponsor"}</strong>.
                                  </>
                                }
                                confirmLabel="Revoke"
                              >
                                Revoke
                              </ConfirmSubmitButton>
                            </form>
                          ) : (
                            <form action={grantAuthority.bind(null, client.id)} className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="sponsorId" value={sponsor.id} />
                              <input type="hidden" name="authorityType" value={type.value} />
                              <input
                                name="evidenceDocumentRef"
                                placeholder="Evidence ref (optional)"
                                className="rounded-md border border-border px-2 py-1 text-xs"
                              />
                              <input type="date" name="effectiveFrom" className="rounded-md border border-border px-2 py-1 text-xs" />
                              <Button type="submit" size="sm" variant="outline">
                                Grant
                              </Button>
                            </form>
                          )}
                        </div>
                      );
                    })}

                    {CONSENT_SCOPES.map((scope) => {
                      const grant = (consentGrants ?? []).find(
                        (row) => row.grantee_user_id === sponsor.user_id && row.scope === scope.value && !row.revoked_at,
                      );
                      const badge = grant
                        ? ({ variant: "success", label: "Captured" } as const)
                        : ({ variant: "neutral", label: "Not granted" } as const);

                      return (
                        <div
                          key={scope.value}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{scope.label}</span>
                            <StatusBadge variant={badge.variant} label={badge.label} />
                          </div>
                          {grant ? (
                            <form action={revokeConsent.bind(null, client.id)}>
                              <input type="hidden" name="consentGrantId" value={grant.id} />
                              <ConfirmSubmitButton
                                size="sm"
                                variant="destructive"
                                confirmTitle="Revoke this consent?"
                                confirmDescription={
                                  <>
                                    This revokes <strong>{scope.label}</strong> for{" "}
                                    <strong>{sponsorUser?.full_name ?? "this sponsor"}</strong>.
                                  </>
                                }
                                confirmLabel="Revoke"
                              >
                                Revoke
                              </ConfirmSubmitButton>
                            </form>
                          ) : (
                            <form action={grantConsent.bind(null, client.id)}>
                              <input type="hidden" name="sponsorId" value={sponsor.id} />
                              <input type="hidden" name="scope" value={scope.value} />
                              <Button type="submit" size="sm" variant="outline">
                                Grant
                              </Button>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </AppShell>
  );
}
```

Note: `Link` is imported but not used directly in this file's JSX — it's imported for
consistency with sibling pages that link elsewhere, but this page currently has no outbound
link. **Remove the unused `Link` import** if `pnpm --filter ops-console lint` flags it
unused in Step 2 below — don't leave an unused import.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter ops-console typecheck && pnpm --filter ops-console lint`
Expected: both exit 0. If lint flags the unused `Link` import noted above, remove that one
line (`import Link from "next/link";`) and re-run.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops-console/app/clients/[id]/page.tsx"
git commit -m "Increment B2: client detail page with authority/consent management"
```

---

### Task 4: Link the onboarding-success message to the new page

**Files:**
- Modify: `apps/ops-console/app/clients/new/page.tsx`

- [ ] **Step 1: Add the Link import**

Find:
```typescript
import { PageHeader } from "@carebridge/ui";
```
Replace with:
```typescript
import Link from "next/link";
import { PageHeader } from "@carebridge/ui";
```

- [ ] **Step 2: Turn the plain success message into a link to the new detail page**

Find:
```typescript
      {onboarded ? <p className="mb-4 text-sm text-success">Client onboarded (id {onboarded}).</p> : null}
```
Replace with:
```typescript
      {onboarded ? (
        <p className="mb-4 text-sm text-success">
          Client onboarded.{" "}
          <Link href={`/clients/${onboarded}`} className="underline">
            Open client record
          </Link>
        </p>
      ) : null}
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter ops-console typecheck && pnpm --filter ops-console lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/ops-console/app/clients/new/page.tsx
git commit -m "Increment B2: link onboarding success message to the new client detail page"
```

---

### Task 5: Verify in the browser against real local Postgres

This is the equivalent of an integration test suite for this codebase — every prior
increment this session was verified this way, not with a component test framework.

**Files:** none (verification only)

- [ ] **Step 1: Start the local stack and dev server**

Run: `supabase start` (or `supabase status` if already running), then
`pnpm --filter ops-console dev` in the background. Set a local password on
`coordinator1@carebridge.dev` via the GoTrue admin API if not already set this session (same
pattern used in every prior increment's verification — `PUT
{API_URL}/auth/v1/admin/users/{user-id}` with the local `SERVICE_ROLE_KEY`, body
`{"password":"carebridge-dev-2026"}`; `coordinator1`'s id is
`a0000000-0000-0000-0000-000000000001`).

- [ ] **Step 2: Onboard a fresh test client through the B1 wizard**

Log in as `coordinator1@carebridge.dev`, go to `/clients/new`, complete all 6 steps with a
sponsor whose email is NOT one of the seeded users (so a real GoTrue account gets created —
exercises the same sponsor-resolution path B1 already proved works), submit. Confirm the
success message now shows a working "Open client record" link (this is Task 4's change —
confirm it navigates to `/clients/<the new id>`, not a 404).

- [ ] **Step 3: Grant an authority_grant-backed authority and verify the badge/evidence render**

On the new client detail page, for the seeded sponsor's row, click "Grant" on Escort
authority (pick escort specifically — it's the one authority type nothing else in the app
has ever created yet, so a successful grant here is real proof this page works, not
coincidentally matching data from another flow). Fill an evidence ref (e.g.
`consents/escort-test.pdf`) and submit. Confirm: the badge flips to "Captured", the evidence
ref renders next to it, and the row now shows a "Revoke" button instead of a "Grant" form.

- [ ] **Step 4: Revoke it and confirm the badge reverts**

Click "Revoke", confirm the dialog names the sponsor and authority type correctly, confirm.
Confirm the badge reverts to "Not granted" and a "Grant" form reappears.

- [ ] **Step 5: Grant and revoke a consent_grant-backed scope**

Repeat steps 3-4 for "Health-update authority" (backed by `consent_grant`, not
`authority_grant`) — confirm it has no evidence-ref field (per the design, that table has no
such column) and behaves correctly through Grant → Captured → Revoke → Not granted.

- [ ] **Step 6: Record a client consent**

Fill and submit the "Client consent to receive care" form (document ref + signed date).
Confirm it appears in the table above the form.

- [ ] **Step 7: Verify directly against Postgres, not just the UI**

Run (adjust the client id to the one created in Step 2):
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres <<'SQL'
select authority_type, status, evidence_document_ref from authority_grant where client_id = '<client-id>';
select scope, granted_at, revoked_at from consent_grant where client_id = '<client-id>';
select document_ref, signed_at from consent_record where client_id = '<client-id>';
SQL
```
Expected: the escort grant from Step 3 shows `status = 'revoked'` (Step 4 revoked it — this
confirms the revoke action actually wrote to the database, not just changed the rendered
badge), the health-update consent_grant row shows a non-null `revoked_at` for the same
reason, and the consent_record row from Step 6 is present with the exact document ref/date
entered.

- [ ] **Step 8: Confirm sponsor scoping — the picker/rows never leak another client's sponsor**

Run:
```bash
docker exec -i supabase_db_carebridge psql -U postgres -d postgres <<'SQL'
select fs.id, fs.client_id, u.full_name
from family_sponsor fs join "user" u on u.id = fs.user_id
where fs.client_id != '<client-id>'
limit 3;
SQL
```
Confirm none of those sponsor names/ids appeared anywhere on the test client's detail page —
the page's `family_sponsor` query is already scoped by `.eq("client_id", client.id)`, this
step just confirms that scoping holds in practice, not only in the query text.

- [ ] **Step 9: Reset and stop**

Reset the local DB to clean seed state (`supabase db reset`) so this session's test client
doesn't linger, stop the dev server, `supabase stop`.

No code changes in this task — if any step's actual result doesn't match expected, stop and
fix the relevant task above (don't patch ad hoc here).

---

### Task 6: Update the roadmap

**Files:**
- Modify: `carebridge-roadmap.md`

- [ ] **Step 1: Mark Increment B2 done in the checklist**

Find the `- [ ] Increment B2 (...)` line. Mark it `- [x]` and append a summary in the same
inline style used by every prior increment above it: what got built (client detail page,
5 server actions, non-uniform card treatment per the design's table-shape reasoning), the
navigation-gap finding and how it was minimally patched, confirmation of real browser
verification against local Postgres (name the specific escort-authority and health-update
scenarios from Task 5, since those are the load-bearing proof), typecheck/lint clean, not
pushed/committed-to-remote unless separately asked.

- [ ] **Step 2: Update the top status line**

Update the `Last updated:` line to note Increment B2 is done and Increment B3
(activation-gate enforcement) is next.

- [ ] **Step 3: Commit**

```bash
git add carebridge-roadmap.md
git commit -m "Roadmap: close Increment B2, next up Increment B3"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** every decision in the design spec maps to a task — new route mirroring
  `/providers/[id]` (Task 3), navigation patch (Task 4), non-uniform card treatment per table
  (Task 3), grants going straight to `active` with no fabricated review workflow (Task 2),
  the five server actions (Task 2) including the resolved `consent_grant` partial-index risk
  item (existence-check-then-insert, not upsert — spelled out in Task 2's code comment).
- **Not covered by this plan, by design (see spec's Non-goals):** clients list/search page,
  emergency-contact editing, review/approval workflow, file upload widget, `consent_grant`
  schema retrofit, general client management (visits/billing/care-plan editing).
- **Local-only:** this plan does not push to hosted `carebridge` or commit/push to `origin`
  beyond local commits — ask before either, per this project's working agreement.
