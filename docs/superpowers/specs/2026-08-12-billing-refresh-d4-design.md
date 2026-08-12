# Increment D4: billing list/detail refresh — design

**Date:** 2026-08-12
**Status:** Approved (brainstorming session)
**Roadmap item:** Ops Console UX Refresh epic, Increment D4

## Context

Roadmap scope: "billing list/detail refresh — human plan names, consistent currency
formatting, status badges, invoice ledger, 'needs attention' view, separate 'create draft
invoice' from 'send payment request' actions" (worker-tier, no schema). Source: UX review's
`13-billing-list.jpg` and `14-billing-detail.jpg` findings.

Today `/billing` lists every `subscription` with a raw `${currency} ${amount}` string (a
`numeric(12,2)` Postgres column loses its trailing zeroes over the JS client, so `1200.00`
renders as `1200`), no status badge, no sponsor/payment context, and no filtering.
`/billing/[id]` shows a single "Generate invoice" button that atomically does four things at
once — insert the `invoice` row, create a `payment` row, request a processor payment link,
and WhatsApp the billing sponsor — with no way to create a draft without immediately
triggering payment/notification side effects, and no protection against firing it twice on
the same invoice.

## Data model (no schema change)

`subscription.status` (`active`/`paused`/`cancelled`), `invoice.status`
(`draft`/`sent`/`paid`/`overdue`/`void`), and `payment.status`
(`pending`/`succeeded`/`failed`/`refunded`) already cover everything this increment needs.

**`invoice.status = 'overdue'` is never written anywhere in this codebase** — the column
allows it, but no cron or app code sets it, so a `sent` invoice past its `due_at` sits at
`sent` forever today. This increment does not add a cron. "Overdue" is computed read-time
(`status === 'sent' && due_at < today`) and shown as a derived badge state, exactly like D1
derived provider-verification badges from evidence tables rather than trusting
`verified_profile`'s manually-maintained flags — the stored `invoice.status` is never
overwritten by this increment.

"Needs attention" is similarly a derived view, not a stored flag: an active subscription with
zero invoices ever created ("never invoiced"), or any invoice that's overdue (per the above)
or whose most recent payment `status = 'failed'`.

"Billing period" (the review's own wording) has no backing field — `invoice` has no
`period_start`/`period_end`, only `due_at`. Not fabricated; logged as a scope cut below.

## New pure-logic module: `apps/ops-console/lib/billing-status.ts`

Same shape as `provider-verification-status.ts`/`roster-coverage.ts` — pure, synchronous,
takes already-fetched rows:

- `SUBSCRIPTION_STATUS_LABEL` / `SUBSCRIPTION_STATUS_VARIANT` (`active`→success,
  `paused`→warning, `cancelled`→neutral)
- `INVOICE_STATUS_LABEL` / `INVOICE_STATUS_VARIANT` (`draft`→neutral, `sent`→information,
  `paid`→success, `overdue`→critical, `void`→neutral) — `overdue` here is the *computed*
  state, not a literal read of the column (see below)
- `PAYMENT_STATUS_LABEL` / `PAYMENT_STATUS_VARIANT` (`pending`→warning, `succeeded`→success,
  `failed`→critical, `refunded`→neutral)
- `isInvoiceOverdue(invoice: { status: string; dueAt: string | null }, todayIso: string):
  boolean` — the one true owner of the overdue computation; both the badge-rendering helper
  and the needs-attention check call this, so they can't disagree.
- `getAttentionReasons(input): string[]` — takes a subscription's status, its invoices, and
  each invoice's most recent payment; returns `[]` (fine) or reason strings: `"never
  invoiced"` (active subscription, zero invoices), `"invoice overdue"` (any invoice
  `isInvoiceOverdue`), `"payment failed"` (any invoice's latest payment `status ===
  'failed'`). A subscription can have more than one reason; all are returned.
- `canSendPaymentRequest(payments: { status: string; createdAt: string }[]): boolean` — the
  duplicate-protection guard: `true` if there are no payments yet, or the most-recent payment
  (by `createdAt`) has `status === 'failed'`; `false` if the latest is `pending` or
  `succeeded`. Shared by the button's render condition and the server action's own check, so
  the two can't drift.

## `apps/ops-console/lib/format.ts`: `formatCurrency`

```ts
const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();

export function formatCurrency(amount: number, currency: string): string {
  let formatter = CURRENCY_FORMATTERS.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "code" });
    CURRENCY_FORMATTERS.set(currency, formatter);
  }
  return formatter.format(amount);
}
```

`currencyDisplay: "code"` renders `"GHS 1,200.00"` / `"USD 450.00"` rather than a symbol —
avoids `$` ambiguity (not used by any of this app's 4 currencies today, but avoids the
pattern) and matches this app's existing "explicit over implicit" formatting stance (same
reasoning `formatDateTime` uses for spelling out "Accra time (GMT)" rather than relying on an
implicit timezone). Formatters are cached per currency code (a `Map`, not re-constructed per
call) since `Intl.NumberFormat` construction is the expensive part and a billing page can
render dozens of amounts in the same currency.

## List (`/billing`)

New `Sponsor` column: each subscription's billing-responsible sponsor name, via the same
`authority_grant` (`authority_type = 'billing_responsible'`, `status = 'active'`) →
`family_sponsor` → `user` join `actions.ts` already does inline for the payment-link email —
factored into a small shared helper, `getBillingResponsibleSponsorName(supabase, clientId):
Promise<string | null>`, in a new `apps/ops-console/lib/billing.ts` (a Supabase-querying
helper, not pure logic, so it doesn't belong in `billing-status.ts` alongside the
label/variant maps) — reused by the list page and the detail page's new "Billing sponsor"
meta field rather than copy-pasted twice.

Amount column uses `formatCurrency`. Plan column keeps the existing `formatPlanName` call
(already correct — this increment doesn't change it, just confirms the review's ask is
already met). New Status column: `SUBSCRIPTION_STATUS_VARIANT`-driven badge.

Filter chips, D1's exact URL-param idiom (`?filter=attention|active|paused|cancelled`, no
persistence): **All** / **Needs attention** / **Active** / **Paused** / **Cancelled**. A
"Needs attention" row shows its reason(s) inline next to the status badge (semicolon-joined,
matching D1/D3's Blocked-reason wording convention).

## Detail (`/billing/[id]`)

`EntitySummaryCard` gains a `"Billing sponsor"` meta entry (name, or `"—"` if none on file —
matches the existing null-handling convention used for every other meta field on this page).

Invoice ledger: each invoice card gets two badges — a Delivery-state badge from
`INVOICE_STATUS_VARIANT`/`isInvoiceOverdue` (showing "Overdue" instead of "Sent" when the
computed check is true, never reading a literal `overdue` value off the column since nothing
ever writes one) and a Processor-state badge from the invoice's most recent payment's
`PAYMENT_STATUS_VARIANT` (no badge if no payment exists yet — a draft invoice legitimately has
none).

**Split action.** The header's single "Generate invoice" `ConfirmSubmitButton` becomes a
plain (non-confirm) `Button`, "Create draft invoice" — inserts the `invoice` row only
(`status: 'draft'`, `due_at` computed the same +7-days way as today), no payment row, no
processor call, no WhatsApp send. Every invoice card additionally gets its own "Send payment
request" `ConfirmSubmitButton` (same confirm copy `generateInvoice` uses today), rendered only
when **both** the invoice's status is `draft` or `sent` (excludes `paid`/`void` explicitly —
`canSendPaymentRequest` alone would wrongly allow a never-invoiced `void` invoice through,
since a voided invoice with zero payments would otherwise read as "no payment yet") **and**
`canSendPaymentRequest` is true for that invoice's payments — this is what closes the review's
duplicate-protection/retry ask: a fresh `draft` has no payments (button shows), a `sent`
invoice whose latest payment is `pending` (button hidden, can't double-fire — and a
`succeeded` payment always accompanies the webhook flipping the invoice to `paid` in the same
update, per `supabase/functions/paystack-webhook/index.ts`, so a `sent` invoice with a
`succeeded` payment shouldn't occur in practice, but the guard covers it either way), and a
`sent` invoice whose latest payment is `failed` leaves the button visible so staff can retry
by firing the same action again (which creates a fresh `payment` row — the old failed one
stays
as history, matching this app's existing revoke-not-delete convention for `authority_grant`
etc.).

Neither webhook (`paystack-webhook`/`stripe-webhook`) ever writes `payment.status = 'failed'`
today — only `'succeeded'` (paystack) or nothing (a failure just leaves it `'pending'`
forever). The retry path above is real (the guard logic is correct for when a `failed` row
exists, and a future webhook enhancement or manual correction could produce one) but currently
unreachable via any live code path — verifying it requires a temporary SQL edit, same as D1's
"Expiring" state had no seeded row and needed one.

## `apps/ops-console/app/billing/[id]/actions.ts`: the split

- `createDraftInvoice(subscriptionId: string, _formData: FormData)`: looks up the
  subscription, computes `dueAt` (+7 days, same as today), inserts `invoice` with
  `status: 'draft'`, redirects to `/billing/{subscriptionId}?draftCreated=1`. No payment
  logic, no `notifyInvoiceReady` call.
- `sendPaymentRequest(invoiceId: string, _formData: FormData)`: looks up the invoice (by id,
  not subscription id — this action is per-invoice now) and its subscription; **re-derives
  `canSendPaymentRequest` server-side** against the invoice's actual current payments before
  doing anything (the button being hidden is a UI nicety, not the enforcement — matches every
  prior increment's "re-check server-side, don't just trust a disabled control" precedent,
  e.g. C1's `scheduleVisit`, C3's severity lock); if blocked, redirects back with an error
  rather than silently no-opping. If allowed, runs today's `generateInvoice` logic from that
  point on unchanged: billing-email lookup, `createPaymentLink`, insert `payment`, flip
  `invoice.status` to `'sent'`, `notifyInvoiceReady`, redirect with `?generated=1`.

Both functions keep today's `redirect`-on-error pattern (no new error-handling idiom
introduced).

## Out of scope

- "Billing period" as a distinct ledger field — no schema field to source it from; not
  fabricated.
- Writing `invoice.status = 'overdue'` anywhere, or any new cron — computed/derived only, per
  Data model above.
- Dashboard MRR changes — `/dashboard`'s existing per-currency display is untouched, not part
  of this epic's D-series scope (already shipped as its own KPI-dashboard story).
- Any change to `lib/payments.ts` (Paystack/Stripe wrappers) or the two webhook Edge
  Functions — this increment only reorders *when* the existing payment-link logic runs, it
  doesn't touch how it runs.
- A real plan/product catalog (`format.ts`'s existing comment on `formatPlanName` floats this
  as a future idea) — that's a schema change, explicitly out of this worker-tier increment.
- Retry beyond "the button reappears when the latest payment failed" — no exponential
  backoff, no automatic retry, no retry-count tracking (no field for it).

## Verification plan

Same bar as prior increments — real local Postgres, not just typechecked:

1. Confirm all 5 seeded subscriptions render on `/billing` with correctly formatted currency
   amounts (`"GHS 1,200.00"` etc.), the right plan names, and status badges.
2. Confirm the 3 subscriptions with zero invoices (`b...002`/`004`/`005`) show "never
   invoiced" under the Needs-attention filter; confirm the seeded `sent` invoice
   (`f8000000-…-02`, due 5 days from seed time — not overdue at seed time) does **not**
   appear as overdue at seed time, then confirm it does after a temporary `due_at` edit to the
   past (reverted after).
3. Confirm the seeded `succeeded` payment's invoice (`f8000000-…-01`, `paid`) shows no "Send
   payment request" button; confirm the `sent`/`pending`-payment invoice
   (`f8000000-…-02`) also shows no button (a `pending` payment blocks re-send, not just
   `succeeded`).
4. Create a draft invoice on a subscription with none, confirm it lands `status='draft'` with
   no `payment` row and no new `whatsapp_message_log` row, confirm its "Send payment request"
   button *is* present.
5. Click "Send payment request" on that draft, confirm the existing generateInvoice behavior
   still fires end-to-end (payment row created, invoice flips to `sent`,
   redirect `?generated=1`), then confirm the button disappears on reload.
6. Bypass the UI (direct POST or devtools) to call `sendPaymentRequest` a second time against
   that now-`sent` invoice; confirm the server rejects it (no second `payment` row created,
   error surfaced) — the actual proof duplicate-protection is server-enforced, not just
   button-hidden.
7. Temporarily `update payment set status = 'failed' where id = ...` on that invoice's payment
   (reverted after); confirm the "Send payment request" button reappears on that `sent`
   invoice, and that firing it again creates a second `payment` row without touching the first.
8. Confirm all 5 filter chips produce the expected row sets against the ground-truth grid
   above.
9. `pnpm --filter ops-console typecheck` and `lint` clean.
