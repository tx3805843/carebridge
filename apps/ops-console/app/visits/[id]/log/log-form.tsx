"use client";

import { useState } from "react";
import { Button } from "@carebridge/ui";

export function LogVisitForm({
  action,
  error,
}: {
  action: (formData: FormData) => void;
  error?: string;
}) {
  const [taskCount, setTaskCount] = useState(1);
  const [observationCount, setObservationCount] = useState(1);
  const [escalationFlagged, setEscalationFlagged] = useState(false);

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

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Escalation</legend>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="escalationFlagged"
            checked={escalationFlagged}
            onChange={(event) => setEscalationFlagged(event.currentTarget.checked)}
          />
          Flag an escalation for this visit
        </label>
        {escalationFlagged ? (
          <>
            <select
              name="escalationSeverity"
              required
              defaultValue=""
              className="rounded-md border border-border px-3 py-2"
            >
              <option value="" disabled>
                Select severity
              </option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
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

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit">Log visit outcome</Button>
    </form>
  );
}
