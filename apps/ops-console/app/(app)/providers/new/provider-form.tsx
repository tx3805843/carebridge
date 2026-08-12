"use client";

import { Button } from "@carebridge/ui";
import { onboardProvider } from "./actions";

interface UserOption {
  id: string;
  label: string;
}

export function ProviderOnboardForm({ users, error }: { users: UserOption[]; error?: string }) {
  return (
    <form action={onboardProvider} className="flex w-full max-w-xl flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Nurse or caregiver
        <select name="userId" required defaultValue="" className="rounded-md border border-border px-3 py-2">
          <option value="" disabled>
            Select a staff-invited user
          </option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.label}
            </option>
          ))}
        </select>
      </label>
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No nurse/caregiver users without a provider profile yet — invite one first.
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Years of experience
        <input
          type="number"
          name="yearsExperience"
          min="0"
          defaultValue="0"
          className="rounded-md border border-border px-3 py-2"
        />
      </label>
      <input
        name="photoUrl"
        placeholder="Photo URL (optional)"
        className="rounded-md border border-border px-3 py-2"
      />
      {error ? <p className="text-sm text-critical">{error}</p> : null}
      <Button type="submit" disabled={users.length === 0}>
        Onboard provider
      </Button>
    </form>
  );
}
