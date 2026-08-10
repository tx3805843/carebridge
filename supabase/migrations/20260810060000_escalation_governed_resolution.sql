-- Ops Console UX Refresh Increment A cont'd — exception queue governed resolution.
-- CLAUDE.md gates "escalation and alert-routing logic" as supervisor-tier ("a missed
-- escalation is a safety incident"); this is a small additive change to the existing
-- escalation table (Domain 7, 20260809210000), not a new consent/authority model like
-- Increment B0's client_relationship split.
--
-- Design note (assigned_to = visible owner): the UX review's P0 finding for the exception
-- queue requires a visible owner per case. escalation had no assignment column —
-- acknowledged_by only records who acknowledged, not who is actively working the case (a
-- coordinator can assign a case to a colleague, or to the Clinical Director for a
-- safeguarding concern, before anyone has acknowledged it).
--
-- Design note (outcome_category): resolution_notes was free text only. The review's P0 case
-- requires a structured outcome category for critical resolution, not just a note. The
-- category set reflects what actually closes an operational exception: confirmed safe,
-- escalated to the Clinical Director, family notified, care plan updated, referred to an
-- external service, or a false alarm.
--
-- Design note (no DB-level "critical requires category+note+clinical_director" constraint):
-- enforced in the resolveEscalation server action instead, matching this table's existing
-- pattern of application-level status-lifecycle enforcement (acknowledged_at/resolved_by
-- have no CHECK tying them to status either). A DB constraint here would need to reach into
-- the `role` table via a subquery on every UPDATE — heavier and more fragile than the server
-- action already sitting in front of every write to this table.

alter table escalation
  add column assigned_to uuid references "user"(id),
  add column outcome_category text check (
    outcome_category in (
      'confirmed_safe',
      'escalated_to_clinical_director',
      'family_notified',
      'care_plan_updated',
      'referred_external',
      'false_alarm',
      'other'
    )
  );

create index escalation_assigned_to_idx on escalation (assigned_to);
