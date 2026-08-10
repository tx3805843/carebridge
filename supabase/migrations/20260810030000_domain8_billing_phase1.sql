-- Domain 8 — Billing & Financial Controls, Phase 1 minimum: subscription, invoice, payment.
-- `prepaid_wallet` and `expense_approval` are deliberately NOT built here — the roadmap
-- scopes those to Phase 3 ("Financial controls" epic), separate from Phase 1's "payment
-- links" minimum (Paystack GHS, Stripe USD/GBP/EUR). Don't add them speculatively.
--
-- Design note (billing visibility is narrower than visit/checkin structural data): every
-- other Domain 2/4 structural table (client, emergency_contact, visit, visit_checkin) is
-- visible to ANY linked family sponsor without a consent grant. Money is more sensitive than
-- "which zone is the visit in" — a sponsor who is linked but not billing-responsible (e.g. a
-- secondary relative CC'd on care, per client_relationship.is_billing_responsible) has no
-- inherent reason to see subscription pricing or invoice amounts. RLS below gates through a
-- new internal.is_billing_responsible_sponsor() helper, not internal.is_linked_sponsor().
--
-- Design note (write-scoping learned from the credentialing epic's two real bugs): the
-- Paystack/Stripe webhook Edge Functions run as service_role with no user session, and
-- previously that broke on (a) missing service_role table grants and (b) created_by columns
-- that default to auth.uid(). Both are handled proactively here instead of via a follow-up
-- fix: service_role grants are included in this same migration, and the two webhook
-- functions only ever UPDATE an existing `payment`/`invoice` row (never INSERT) — the row is
-- always first created by a real staff session (ops-console's "generate invoice" action), so
-- created_by's `not null default auth.uid()` never has to resolve for a service-role caller.

create table subscription (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  plan_code text not null,
  currency text not null check (currency in ('GHS', 'USD', 'GBP', 'EUR')),
  amount numeric(12, 2) not null check (amount > 0),
  billing_interval text not null default 'monthly' check (billing_interval in ('weekly', 'monthly')),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index subscription_client_id_idx on subscription (client_id);

create trigger subscription_set_updated_at
  before update on subscription
  for each row execute function public.set_updated_at();

create table invoice (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  subscription_id uuid not null references subscription(id),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('GHS', 'USD', 'GBP', 'EUR')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'overdue', 'void')),
  due_at date,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index invoice_client_id_idx on invoice (client_id);
create index invoice_subscription_id_idx on invoice (subscription_id);

create trigger invoice_set_updated_at
  before update on invoice
  for each row execute function public.set_updated_at();

create table payment (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoice(id),
  processor text not null check (processor in ('paystack', 'stripe')),
  processor_reference text, -- our own generated reference (Paystack) / client_reference_id (Stripe), set at creation
  payment_link_url text,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('GHS', 'USD', 'GBP', 'EUR')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create unique index payment_processor_reference_unique
  on payment (processor, processor_reference)
  where processor_reference is not null;
create index payment_invoice_id_idx on payment (invoice_id);

create trigger payment_set_updated_at
  before update on payment
  for each row execute function public.set_updated_at();

-- ── RLS helper ───────────────────────────────────────────────────────────────────────
-- Created directly in `internal` (never `public`) from the start — avoids the
-- PostgREST-RPC-exposure class of bug fixed for the original 8 helpers in
-- 20260809180000_security_hardening.sql. References internal.* (not public.*) for the same
-- reason the is_staff() cross-reference bug happened in 20260809200000.

create or replace function internal.is_billing_responsible_sponsor(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from client_relationship cr
    join family_sponsor fs on fs.id = cr.sponsor_id
    where cr.client_id = target_client_id
      and fs.user_id = auth.uid()
      and cr.is_billing_responsible = true
  )
$$;

-- ── RLS: subscription ────────────────────────────────────────────────────────────────

alter table subscription enable row level security;

create policy subscription_select_staff_or_billing_sponsor on subscription
  for select
  to authenticated
  using (internal.is_staff() or internal.is_billing_responsible_sponsor(client_id));

create policy subscription_write_staff on subscription
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: invoice ─────────────────────────────────────────────────────────────────────

alter table invoice enable row level security;

create policy invoice_select_staff_or_billing_sponsor on invoice
  for select
  to authenticated
  using (internal.is_staff() or internal.is_billing_responsible_sponsor(client_id));

create policy invoice_write_staff on invoice
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: payment ─────────────────────────────────────────────────────────────────────
-- No client_id column directly on payment — resolved through invoice.client_id. A billing
-- sponsor can read their own payment status (e.g. "did my card go through") but can never
-- write: payment status only ever changes via a processor webhook or staff, never
-- self-reported, which would defeat the point of verifying with the processor at all.

alter table payment enable row level security;

create policy payment_select_staff_or_billing_sponsor on payment
  for select
  to authenticated
  using (
    internal.is_staff()
    or exists (
      select 1 from invoice i
      where i.id = payment.invoice_id
        and internal.is_billing_responsible_sponsor(i.client_id)
    )
  );

create policy payment_write_staff on payment
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── Audit triggers ───────────────────────────────────────────────────────────────────

create trigger subscription_audit after insert or update or delete on subscription for each row execute function internal.audit_row_change();
create trigger invoice_audit after insert or update or delete on invoice for each row execute function internal.audit_row_change();
create trigger payment_audit after insert or update or delete on payment for each row execute function internal.audit_row_change();

-- ── Grants ───────────────────────────────────────────────────────────────────────────
-- Both authenticated (RLS-scoped: staff full, billing sponsor read-only) and service_role
-- (the two payment webhooks, UPDATE-only per the design note above) in this same migration —
-- learned from the credentialing epic needing a follow-up grants migration.

grant select, insert, update, delete on subscription to authenticated;
grant select, insert, update, delete on invoice to authenticated;
grant select, insert, update, delete on payment to authenticated;

grant select, insert, update, delete on subscription to service_role;
grant select, insert, update, delete on invoice to service_role;
grant select, insert, update, delete on payment to service_role;
