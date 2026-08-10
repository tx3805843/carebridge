-- Closes the last real gap in the Phase 1 "measurable from console" exit criterion: two of
-- the six named KPIs (staff retention, referral rate) had no underlying data model at all
-- (see carebridge-roadmap.md open items logged 2026-08-10). Both are small additive columns
-- on existing tables — no new tables, no new RLS policies needed (existing provider/client
-- policies already cover these columns).
--
-- provider.employment_status: a real schema decision, not a trivial add. Kept to 3 states —
-- 'active' | 'on_leave' | 'departed' — deliberately not a richer status machine (no
-- 'suspended': that's already covered by verified_profile.nmc_licensed, a credentialing
-- concept, not an employment one; conflating the two would make "why can't this nurse be
-- scheduled" ambiguous between two different reasons). departure_reason is free text, not an
-- enum — reasons for a care worker leaving (voluntary, performance, safeguarding, etc.) don't
-- have a stable small vocabulary yet, and CLAUDE.md's safeguarding-complaint routing already
-- has a dedicated home (incident_report / escalation), not this field.

alter table provider
  add column employment_status text not null default 'active'
    check (employment_status in ('active', 'on_leave', 'departed')),
  add column departed_at timestamptz,
  add column departure_reason text;

-- client.referral_source: optional at onboarding (not required — don't block client
-- onboarding on a marketing-attribution field). Value set chosen for a diaspora-family home
-- care business specifically: 'existing_family_referral' is the metric Phase 1's "referral
-- rate" exit criterion actually means (organic growth from families who already use
-- CareBridge), the others exist so the field isn't a lie when the true source is something
-- else. Not the Domain 6 `referral` table (a different, Phase 3, care-coordination concept —
-- referring a client to an external provider, not "how did this family find CareBridge").

alter table client
  add column referral_source text
    check (referral_source in (
      'existing_family_referral', 'staff_referral', 'social_media', 'community_event', 'search_online', 'other'
    ));
