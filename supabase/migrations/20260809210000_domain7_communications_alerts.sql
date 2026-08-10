-- Domain 7 — Communications & Alerts: alert_rule, escalation, notification,
-- whatsapp_message_log. Coordinator-console epic Story 3 (carebridge-roadmap.md, Phase 1) —
-- blocks Stories 5-6 (manual visit logging UI's escalation flag, exception queue). Also the
-- schema half of the WhatsApp family-communication epic (notification/whatsapp_message_log
-- are shared between the two epics, per the roadmap's Story 3 note).
--
-- Design note (escalation is first-class, not a notification subtype): per
-- docs/domain-model.md's cross-cutting rule and CLAUDE.md ("a missed escalation is a safety
-- incident"), escalation carries its own severity/status lifecycle independent of how or
-- whether it was ever delivered as a notification. This migration keeps that separation:
-- escalation has no FK to notification, and notification has no FK to escalation — the two
-- are correlated by application logic (timing/client), not a schema constraint, matching
-- domain-model.md's listed entity boundaries exactly.
--
-- Design note (escalation expanded beyond the placeholder for a real status lifecycle):
-- packages/domain/src/communications.ts's placeholder Escalation has only
-- status: open/acknowledged/resolved with no actor/timestamp tracking for the transitions.
-- Added acknowledged_at/acknowledged_by and resolved_at/resolved_by/resolution_notes — without
-- them "who acknowledged this and when" (the whole point of an exception queue: proving
-- nothing fell through) isn't answerable. Also added `reason` (not in the placeholder): a
-- bare severity+status with no content isn't a usable exception-queue row.
--
-- Design note (staff-only visibility on alert_rule/escalation): unlike zone/credential_type,
-- there's no identified Phase 1 story needing provider or family-sponsor read access to
-- either table. escalation in particular may concern a provider's own performance or a
-- safeguarding matter about them — CLAUDE.md is explicit that safeguarding complaints route
-- to the clinical director only and are never surfaced as a rating; showing a provider
-- escalations about themselves is a real future story, not a default. Starting staff-only is
-- the conservative default; broadening later is easy, narrowing after a leak is not.
--
-- Design note (notification is self-readable, whatsapp_message_log is not): notification
-- records "user X was notified via channel Y at time Z" — low sensitivity, and a family
-- sponsor plausibly wants their own notification history (Phase 2 family-portal territory,
-- but the RLS policy itself costs nothing to get right now). whatsapp_message_log is
-- lower-level infra (phone numbers, delivery status, Meta message IDs) with no
-- per-notification user_id at all (toPhone, not userId, per the placeholder) — staff/ops-only,
-- matching the "manual-first" operational-log pattern used for credential tables.
--
-- Design note (no rule-engine evaluation here): alert_rule.condition is free text, not an
-- evaluated expression — this migration models the config table, not a condition-evaluation
-- engine. What actually creates an escalation row (a cron/Edge Function reading alert_rule
-- and observation/visit data, vs. staff creating one manually) is a future story.

-- ── alert_rule ───────────────────────────────────────────────────────────────────────

create table alert_rule (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  condition text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create trigger alert_rule_set_updated_at
  before update on alert_rule
  for each row execute function public.set_updated_at();

-- ── escalation ───────────────────────────────────────────────────────────────────────

create table escalation (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id),
  visit_id uuid references visit(id),
  triggered_by_rule_id uuid references alert_rule(id),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_at timestamptz,
  acknowledged_by uuid references "user"(id),
  resolved_at timestamptz,
  resolved_by uuid references "user"(id),
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index escalation_client_id_idx on escalation (client_id);
create index escalation_visit_id_idx on escalation (visit_id);
create index escalation_status_idx on escalation (status);

create trigger escalation_set_updated_at
  before update on escalation
  for each row execute function public.set_updated_at();

-- ── notification ─────────────────────────────────────────────────────────────────────

create table notification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  channel text not null check (channel in ('whatsapp', 'sms', 'push', 'email')),
  template_id text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references "user"(id)
);

create index notification_user_id_idx on notification (user_id);

create trigger notification_set_updated_at
  before update on notification
  for each row execute function public.set_updated_at();

-- ── whatsapp_message_log ─────────────────────────────────────────────────────────────

create table whatsapp_message_log (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null,
  template_name text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  wa_message_id text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references "user"(id) -- nullable: the whatsapp-webhook Edge Function runs as service_role, no auth.uid()
);

create index whatsapp_message_log_to_phone_idx on whatsapp_message_log (to_phone);

create trigger whatsapp_message_log_set_updated_at
  before update on whatsapp_message_log
  for each row execute function public.set_updated_at();

-- ── RLS: alert_rule ──────────────────────────────────────────────────────────────────

alter table alert_rule enable row level security;

create policy alert_rule_select_staff on alert_rule
  for select
  to authenticated
  using (internal.is_staff());

create policy alert_rule_write_staff on alert_rule
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: escalation ──────────────────────────────────────────────────────────────────

alter table escalation enable row level security;

create policy escalation_select_staff on escalation
  for select
  to authenticated
  using (internal.is_staff());

create policy escalation_write_staff on escalation
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: notification ────────────────────────────────────────────────────────────────

alter table notification enable row level security;

create policy notification_select_self_or_staff on notification
  for select
  to authenticated
  using (user_id = auth.uid() or internal.is_staff());

create policy notification_write_staff on notification
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── RLS: whatsapp_message_log ────────────────────────────────────────────────────────

alter table whatsapp_message_log enable row level security;

create policy whatsapp_message_log_select_staff on whatsapp_message_log
  for select
  to authenticated
  using (internal.is_staff());

create policy whatsapp_message_log_write_staff on whatsapp_message_log
  for all
  to authenticated
  using (internal.is_staff())
  with check (internal.is_staff());

-- ── Audit triggers ───────────────────────────────────────────────────────────────────

create trigger alert_rule_audit after insert or update or delete on alert_rule for each row execute function internal.audit_row_change();
create trigger escalation_audit after insert or update or delete on escalation for each row execute function internal.audit_row_change();
create trigger notification_audit after insert or update or delete on notification for each row execute function internal.audit_row_change();
create trigger whatsapp_message_log_audit after insert or update or delete on whatsapp_message_log for each row execute function internal.audit_row_change();

-- ── Grants ───────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on alert_rule to authenticated;
grant select, insert, update, delete on escalation to authenticated;
grant select, insert, update, delete on notification to authenticated;
grant select, insert, update, delete on whatsapp_message_log to authenticated;
