"use client";

import { useState } from "react";
import { Button } from "@carebridge/ui";
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

export function VisitForm({
  clients,
  matrix,
  error,
}: {
  clients: Option[];
  matrix: Record<string, ClientEligibility>;
  error?: string;
}) {
  const [clientId, setClientId] = useState("");
  const eligibility = matrix[clientId];

  return (
    <form action={scheduleVisit} className="flex w-full max-w-xl flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Client
        <select
          name="clientId"
          required
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
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
          key={clientId}
          name="providerId"
          required
          defaultValue=""
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
          className="rounded-md border border-border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Scheduled end
        <input
          type="datetime-local"
          name="scheduledEnd"
          required
          className="rounded-md border border-border px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-critical">{error}</p> : null}
      <Button type="submit">Schedule visit</Button>
    </form>
  );
}
