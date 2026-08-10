"use client";

import { Button } from "@carebridge/ui";
import { inviteStaffMember } from "./actions";

interface RoleOption {
  slug: string;
  label: string;
}

export function StaffInviteForm({ roles, error }: { roles: RoleOption[]; error?: string }) {
  return (
    <form action={inviteStaffMember} className="flex w-full max-w-xl flex-col gap-3">
      <input
        name="fullName"
        placeholder="Full name"
        required
        className="rounded-md border border-border px-3 py-2"
      />
      <input
        name="email"
        type="email"
        placeholder="Email"
        required
        className="rounded-md border border-border px-3 py-2"
      />
      <input name="phone" placeholder="Phone (optional)" className="rounded-md border border-border px-3 py-2" />
      <select name="roleSlug" required defaultValue="" className="rounded-md border border-border px-3 py-2">
        <option value="" disabled>
          Select a role
        </option>
        {roles.map((role) => (
          <option key={role.slug} value={role.slug}>
            {role.label}
          </option>
        ))}
      </select>
      <p className="text-sm text-muted-foreground">
        This creates the account only — no email is sent. The new user cannot log in until a
        password reset/activation flow is completed (not built yet, see roadmap); until then,
        set a password for them directly if they need access sooner.
      </p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit">Create staff account</Button>
    </form>
  );
}
