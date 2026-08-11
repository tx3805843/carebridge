"use client";

import { useState } from "react";
import { ConfirmSubmitButton } from "@carebridge/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { scheduleVisit } from "./actions";

interface Option {
  id: string;
  label: string;
}

interface BlockedOption extends Option {
  reasons: string[];
}

interface ClientEligibility {
  eligible: Option[];
  blocked: BlockedOption[];
}

interface CarePlanSummary {
  effectiveFrom: string;
  summary: string;
}

interface ExistingVisit {
  clientLabel: string;
  scheduledStart: string;
  scheduledEnd: string;
}

interface Snapshot {
  clientId: string;
  providerId: string;
  scheduledStart: string;
  scheduledEnd: string;
}

const EMPTY_SNAPSHOT: Snapshot = { clientId: "", providerId: "", scheduledStart: "", scheduledEnd: "" };

// Two half-open ranges [aStart, aEnd) and [bStart, bEnd) overlap iff aStart < bEnd && bStart < aEnd.
// Returns the first conflicting existing visit for this provider, or null if none (including
// while any of the four inputs needed to compute this are still empty/invalid).
function findConflict(
  providerId: string,
  scheduledStart: string,
  scheduledEnd: string,
  visitsByProviderId: Record<string, ExistingVisit[]>,
): ExistingVisit | null {
  if (!providerId || !scheduledStart || !scheduledEnd) {
    return null;
  }

  const newStart = new Date(scheduledStart).getTime();
  const newEnd = new Date(scheduledEnd).getTime();

  if (Number.isNaN(newStart) || Number.isNaN(newEnd) || newEnd <= newStart) {
    return null;
  }

  const existingVisits = visitsByProviderId[providerId] ?? [];

  return (
    existingVisits.find((visit) => {
      const existingStart = new Date(visit.scheduledStart).getTime();
      const existingEnd = new Date(visit.scheduledEnd).getTime();
      return existingStart < newEnd && newStart < existingEnd;
    }) ?? null
  );
}

export function VisitForm({
  clients,
  matrix,
  zoneNameByClientId,
  careplanByClientId,
  visitsByProviderId,
  error,
}: {
  clients: Option[];
  matrix: Record<string, ClientEligibility>;
  zoneNameByClientId: Record<string, string>;
  careplanByClientId: Record<string, CarePlanSummary | null>;
  visitsByProviderId: Record<string, ExistingVisit[]>;
  error?: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);

  const eligibility = matrix[snapshot.clientId];
  const zoneName = snapshot.clientId ? zoneNameByClientId[snapshot.clientId] : undefined;
  const carePlan = snapshot.clientId ? careplanByClientId[snapshot.clientId] : undefined;
  const conflict = findConflict(snapshot.providerId, snapshot.scheduledStart, snapshot.scheduledEnd, visitsByProviderId);

  const selectedClientLabel = clients.find((client) => client.id === snapshot.clientId)?.label ?? "";
  const selectedProviderLabel =
    eligibility?.eligible.find((provider) => provider.id === snapshot.providerId)?.label ?? "";

  const canSubmit = Boolean(
    snapshot.clientId && snapshot.providerId && snapshot.scheduledStart && snapshot.scheduledEnd,
  );

  return (
    <form action={scheduleVisit} className="flex w-full max-w-xl flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Client
        <select
          name="clientId"
          required
          value={snapshot.clientId}
          onChange={(event) =>
            setSnapshot((prev) => ({ ...prev, clientId: event.target.value, providerId: "" }))
          }
          className="rounded-md border border-border px-3 py-2"
        >
          <option value="" disabled>
            Select a client
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Provider
        <select
          name="providerId"
          required
          value={snapshot.providerId}
          onChange={(event) => setSnapshot((prev) => ({ ...prev, providerId: event.target.value }))}
          disabled={!eligibility}
          className="rounded-md border border-border px-3 py-2 disabled:cursor-not-allowed disabled:bg-muted"
        >
          <option value="" disabled>
            {eligibility ? "Select a provider" : "Select a client first"}
          </option>
          {eligibility ? (
            <>
              <optgroup label="Eligible">
                {eligibility.eligible.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Blocked">
                {eligibility.blocked.map((provider) => (
                  <option key={provider.id} value={provider.id} disabled>
                    {provider.label} — {provider.reasons.join("; ")}
                  </option>
                ))}
              </optgroup>
            </>
          ) : null}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Scheduled start
        <input
          type="datetime-local"
          name="scheduledStart"
          required
          value={snapshot.scheduledStart}
          onChange={(event) => setSnapshot((prev) => ({ ...prev, scheduledStart: event.target.value }))}
          className="rounded-md border border-border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Scheduled end
        <input
          type="datetime-local"
          name="scheduledEnd"
          required
          value={snapshot.scheduledEnd}
          onChange={(event) => setSnapshot((prev) => ({ ...prev, scheduledEnd: event.target.value }))}
          className="rounded-md border border-border px-3 py-2"
        />
      </label>

      {snapshot.clientId ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4 text-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scheduling summary</h2>
          <p>
            <span className="font-medium">Zone:</span> {zoneName ?? "No zone"}
          </p>
          <p>
            <span className="font-medium">Care plan:</span>{" "}
            {carePlan ? `effective ${formatDate(carePlan.effectiveFrom)}: ${carePlan.summary}` : "No care plan yet"}
          </p>
          {conflict ? (
            <p className="text-warning">
              Conflict: this provider already has a visit scheduled for {conflict.clientLabel} at{" "}
              {formatDateTime(conflict.scheduledStart)}–{formatDateTime(conflict.scheduledEnd)}.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-critical">{error}</p> : null}

      <ConfirmSubmitButton
        disabled={!canSubmit}
        confirmTitle="Schedule visit"
        confirmDescription={
          conflict ? (
            <>
              Schedule <strong>{selectedProviderLabel}</strong> for <strong>{selectedClientLabel}</strong>. This
              provider already has a visit scheduled for {conflict.clientLabel} at{" "}
              {formatDateTime(conflict.scheduledStart)}–{formatDateTime(conflict.scheduledEnd)} — schedule anyway?
            </>
          ) : (
            <>
              Schedule <strong>{selectedProviderLabel}</strong> for <strong>{selectedClientLabel}</strong>?
            </>
          )
        }
        confirmLabel="Schedule visit"
      >
        Schedule visit
      </ConfirmSubmitButton>
    </form>
  );
}
