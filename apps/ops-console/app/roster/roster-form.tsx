"use client";

import { Button } from "@carebridge/ui";
import { addRosterAssignment } from "./actions";

interface Option {
  id: string;
  label: string;
}

export function RosterForm({ providers, zones, error }: { providers: Option[]; zones: Option[]; error?: string }) {
  return (
    <form action={addRosterAssignment} className="flex flex-wrap items-end gap-3">
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
        Zone
        <select name="zoneId" required defaultValue="" className="rounded-md border border-border px-3 py-2">
          <option value="" disabled>
            Select a zone
          </option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Week starting
        <input type="date" name="weekStarting" required className="rounded-md border border-border px-3 py-2" />
      </label>
      <Button type="submit">Assign</Button>
      {error ? <p className="w-full text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
