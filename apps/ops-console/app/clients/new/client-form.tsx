"use client";

import { useState } from "react";
import { Button } from "@carebridge/ui";
import { onboardClient } from "./actions";

interface Zone {
  id: string;
  name: string;
}

export function NewClientForm({ zones, error }: { zones: Zone[]; error?: string }) {
  const [contactCount, setContactCount] = useState(1);
  const [sponsorCount, setSponsorCount] = useState(1);

  return (
    <form action={onboardClient} className="flex w-full max-w-xl flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Client</legend>
        <input name="fullName" placeholder="Full name" required className="rounded-md border border-border px-3 py-2" />
        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
          Date of birth
          <input type="date" name="dateOfBirth" required className="rounded-md border border-border px-3 py-2" />
        </label>
        <input name="address" placeholder="Address" required className="rounded-md border border-border px-3 py-2" />
        <select name="zoneId" required defaultValue="" className="rounded-md border border-border px-3 py-2">
          <option value="" disabled>
            Select a zone
          </option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Care plan</legend>
        <textarea
          name="careSummary"
          placeholder="Care plan summary"
          required
          rows={4}
          className="rounded-md border border-border px-3 py-2"
        />
        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
          Review due (optional)
          <input type="date" name="reviewDueAt" className="rounded-md border border-border px-3 py-2" />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Emergency contacts</legend>
        {Array.from({ length: contactCount }, (_, index) => (
          <div key={index} className="flex gap-2">
            <input
              name="contactFullName"
              placeholder="Contact name"
              required={index === 0}
              className="flex-1 rounded-md border border-border px-3 py-2"
            />
            <input
              name="contactPhone"
              placeholder="Phone"
              required={index === 0}
              className="flex-1 rounded-md border border-border px-3 py-2"
            />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setContactCount((count) => count + 1)}>
          Add another contact
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">Family sponsors</legend>
        <input type="hidden" name="sponsorRowCount" value={sponsorCount} />
        {Array.from({ length: sponsorCount }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex gap-2">
              <input
                name={`sponsorFullName-${index}`}
                placeholder="Sponsor name"
                required={index === 0}
                className="flex-1 rounded-md border border-border px-3 py-2"
              />
              <input
                name={`sponsorEmail-${index}`}
                type="email"
                placeholder="Sponsor email"
                required={index === 0}
                className="flex-1 rounded-md border border-border px-3 py-2"
              />
            </div>
            <input
              name={`sponsorRelationship-${index}`}
              placeholder="Relationship (e.g. Daughter)"
              required={index === 0}
              className="rounded-md border border-border px-3 py-2"
            />
            <div className="flex gap-4 text-sm text-muted-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" name={`sponsorIsDecisionMaker-${index}`} />
                Decision-maker
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name={`sponsorIsBillingResponsible-${index}`} />
                Billing-responsible
              </label>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setSponsorCount((count) => count + 1)}>
          Add another sponsor
        </Button>
      </fieldset>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit">Onboard client</Button>
    </form>
  );
}
