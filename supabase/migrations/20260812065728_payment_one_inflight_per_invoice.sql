-- Closes a real TOCTOU race found in D4 code review of apps/ops-console/app/billing/[id]/
-- actions.ts#sendPaymentRequest: the app-level canSendPaymentRequest guard (lib/billing-status.ts)
-- and the subsequent `payment` insert are two separate round trips with no lock between them,
-- so two near-simultaneous calls for the same invoice (a double-click on the confirm dialog,
-- or two staff tabs open on the same invoice) could both pass the guard before either has
-- inserted, each request a live processor payment link, and each insert its own payment row —
-- a real double-charge risk. `payment_processor_reference_unique`
-- (20260810030000_domain8_billing_phase1.sql) does not catch this: processor_reference is a
-- freshly generated randomUUID() per call, so two concurrent calls never collide on it.
--
-- This partial unique index makes the database the actual arbiter — at most one payment row
-- per invoice may be in-flight (pending) or already succeeded at any time; a losing concurrent
-- insert now fails with a 23505 unique violation instead of silently creating a second live
-- payment attempt. sendPaymentRequest catches that violation and redirects with the same
-- "already sent" error the app-level guard already uses — the guard stays as a fast,
-- no-round-trip UX check, this index is the real enforcement. `failed` payments are
-- deliberately excluded from the constraint (not listed in the `where` clause) so the existing
-- retry path (insert a fresh payment row after a failed one) is unaffected.

create unique index payment_one_inflight_per_invoice
  on payment (invoice_id)
  where status in ('pending', 'succeeded');
