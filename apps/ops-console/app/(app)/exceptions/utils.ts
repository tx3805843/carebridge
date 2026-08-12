import { RESPONSE_TARGET_MINUTES } from "./constants";

interface EscalationAuditRow {
  operation: string;
  actor_user_id: string | null;
  old_data: unknown;
  new_data: unknown;
  occurred_at: string;
}

export interface TimelineEntry {
  label: string;
  occurredAt: string;
  actorName: string;
}

// Reads escalation.'s own audit_log trail (the append-only, tamper-resistant record CLAUDE.md
// requires) instead of reconstructing history from a handful of nullable columns — the
// review's "activity and evidence" timeline and "preserve the original report" rule are both
// just... what audit_log already is. The INSERT row's new_data.reason is the immutable
// original report; nothing here can overwrite it, only append later UPDATE rows.
export function buildEscalationTimeline(
  rows: EscalationAuditRow[],
  actorNameById: Map<string, string>,
  outcomeCategoryLabel: Record<string, string>,
): TimelineEntry[] {
  const actorName = (id: string | null) => (id ? actorNameById.get(id) ?? "Unknown staff" : "System");

  return rows.map((row) => {
    const actor = actorName(row.actor_user_id);

    if (row.operation === "INSERT") {
      return { label: "Escalation opened", occurredAt: row.occurred_at, actorName: actor };
    }

    const oldData = (row.old_data ?? {}) as Record<string, unknown>;
    const newData = (row.new_data ?? {}) as Record<string, unknown>;

    if (newData.status === "resolved" && oldData.status !== "resolved") {
      const category =
        typeof newData.outcome_category === "string" ? outcomeCategoryLabel[newData.outcome_category] : null;
      return {
        label: category ? `Resolved — ${category}` : "Resolved",
        occurredAt: row.occurred_at,
        actorName: actor,
      };
    }

    if (newData.status === "acknowledged" && oldData.status !== "acknowledged") {
      return { label: "Acknowledged", occurredAt: row.occurred_at, actorName: actor };
    }

    if (newData.assigned_to && newData.assigned_to !== oldData.assigned_to) {
      const assigneeName =
        typeof newData.assigned_to === "string" ? actorNameById.get(newData.assigned_to) ?? "a colleague" : "a colleague";
      return { label: `Assigned to ${assigneeName}`, occurredAt: row.occurred_at, actorName: actor };
    }

    return { label: "Case updated", occurredAt: row.occurred_at, actorName: actor };
  });
}

// The review's "show a response target" rule (interaction rule 4: "show source and freshness
// for computed status"). There's no SLA-clock schema — this is a fixed operational policy
// computed at render time from `created_at`, not a stored/configurable deadline.
export function formatResponseTarget(createdAt: string, severity: string, status: string): string | null {
  if (status !== "open") return null;
  const targetMinutes = RESPONSE_TARGET_MINUTES[severity] ?? 1440;
  const deadline = new Date(createdAt).getTime() + targetMinutes * 60_000;
  const diffMinutes = Math.round((deadline - Date.now()) / 60_000);
  if (diffMinutes >= 0) return `Acknowledge in ${diffMinutes}m`;
  return `${Math.abs(diffMinutes)}m overdue`;
}
