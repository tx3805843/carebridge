"use client";

import { Button } from "@carebridge/ui";
import { scheduleVisit } from "./actions";

interface Option {
  id: string;
  label: string;
}

export function VisitForm({
  clients,
  providers,
  error,
}: {
  clients: Option[];
  providers: Option[];
  error?: string;
}) {
  return (
    <form action={scheduleVisit} className="flex w-full max-w-xl flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Client
        <select name="clientId" required defaultValue="" className="rounded-md border border-border px-3 py-2">
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
        <select name="providerId" required defaultValue="" className="rounded-md border border-border px-3 py-2">
          <option value="" disabled>
            Select a provider
          </option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
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
