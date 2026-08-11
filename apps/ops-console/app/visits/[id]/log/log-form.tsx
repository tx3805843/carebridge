"use client";

import { useState } from "react";
import { Button, StatusBadge } from "@carebridge/ui";
import { RESPONSE_TARGET_MINUTES, SEVERITY_BADGE_VARIANT, SEVERITY_LABEL } from "@/app/exceptions/constants";

const CONCERN_SEVERITIES = ["high", "medium", "low"] as const;

// "15 min" / "1h" / "4h" / "1d" — a short, readable form of the response-target policy for
// inline guidance next to a severity choice. Distinct from exceptions/utils.ts's
// formatResponseTarget, which computes a live countdown from a stored created_at; this is a
// static duration label with no time-of-day dependency.
function formatTargetDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export function LogVisitForm({
  action,
  error,
}: {
  action: (formData: FormData) => void;
  error?: string;
}) {
  const [taskCount, setTaskCount] = useState(1);
  const [observationCount, setObservationCount] = useState(1);
  const [clientSafe, setClientSafe] = useState<"yes" | "no" | "">("");
  const [concernFlagged, setConcernFlagged] = useState(false);
  const [concernSeverity, setConcernSeverity] = useState("");

  return (
    <form action={action} className="flex w-full max-w-xl flex-col gap-6">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Arrival time
        <input
          type="datetime-local"
          name="arrivedAt"
          required
          className="rounded-md border border-border px-3 py-2"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-lg font-medium">Is the client safe right now?</legend>
        <input type="hidden" name="clientSafe" value={clientSafe} />
        <div className="flex gap-3">
          <Button
            type="button"
            variant={clientSafe === "yes" ? "default" : "outline"}
            onClick={() => setClientSafe("yes")}
          >
            Yes, client is safe
          </Button>
          <Button
            type="button"
            variant={clientSafe === "no" ? "destructive" : "outline"}
            onClick={() => {
              setClientSafe("no");
              setConcernFlagged(false);
              setConcernSeverity("");
            }}
          >
            No, safety concern
          </Button>
        </div>
      </fieldset>

      {clientSafe === "no" ? (
        <fieldset className="flex flex-col gap-3 rounded-md border border-critical/30 bg-critical/5 p-4">
          <legend className="flex items-center gap-2 text-lg font-medium">
            Escalation
            <StatusBadge variant={SEVERITY_BADGE_VARIANT.critical!} label={SEVERITY_LABEL.critical!} />
          </legend>
          <p className="text-sm text-muted-foreground">
            Response target: {formatTargetDuration(RESPONSE_TARGET_MINUTES.critical!)}. This notifies the
            coordinator and clinical director immediately.
          </p>
          <textarea
            name="escalationReason"
            placeholder="What's happening? Be specific."
            required
            rows={3}
            className="rounded-md border border-border px-3 py-2"
          />
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Tasks completed</legend>
        {Array.from({ length: taskCount }, (_, index) => (
          <input
            key={index}
            name="taskDescription"
            placeholder="Task description"
            className="rounded-md border border-border px-3 py-2"
          />
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setTaskCount((count) => count + 1)}>
          Add another task
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Observations</legend>
        {Array.from({ length: observationCount }, (_, index) => (
          <div key={index} className="flex gap-2">
            <input
              name="observationType"
              placeholder="Type (e.g. blood pressure)"
              className="flex-1 rounded-md border border-border px-3 py-2"
            />
            <input
              name="observationValue"
              placeholder="Value"
              className="flex-1 rounded-md border border-border px-3 py-2"
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setObservationCount((count) => count + 1)}
        >
          Add another observation
        </Button>
      </fieldset>

      {clientSafe === "yes" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-lg font-medium">Non-urgent concern</legend>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              name="concernFlagged"
              checked={concernFlagged}
              onChange={(event) => setConcernFlagged(event.currentTarget.checked)}
            />
            Report a non-urgent concern for this visit
          </label>
          {concernFlagged ? (
            <>
              <select
                name="escalationSeverity"
                required
                value={concernSeverity}
                onChange={(event) => setConcernSeverity(event.target.value)}
                className="rounded-md border border-border px-3 py-2"
              >
                <option value="" disabled>
                  Select severity
                </option>
                {CONCERN_SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABEL[severity]!} — response target {formatTargetDuration(RESPONSE_TARGET_MINUTES[severity]!)}
                  </option>
                ))}
              </select>
              {concernSeverity ? (
                <StatusBadge
                  variant={SEVERITY_BADGE_VARIANT[concernSeverity]!}
                  label={SEVERITY_LABEL[concernSeverity]!}
                />
              ) : null}
              <textarea
                name="escalationReason"
                placeholder="Reason"
                required
                rows={3}
                className="rounded-md border border-border px-3 py-2"
              />
            </>
          ) : null}
        </fieldset>
      ) : null}

      {error ? <p className="text-sm text-critical">{error}</p> : null}
      <Button type="submit" disabled={clientSafe === ""}>
        Log visit outcome
      </Button>
    </form>
  );
}
