"use client";

import { Button } from "@carebridge/ui";
import { createSubscription } from "./actions";

interface ClientOption {
  id: string;
  label: string;
}

export function NewSubscriptionForm({ clients, error }: { clients: ClientOption[]; error?: string }) {
  return (
    <form action={createSubscription} className="flex w-full max-w-xl flex-col gap-3">
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
      <input name="planCode" placeholder="Plan name (e.g. Standard Weekly Care)" required className="rounded-md border border-border px-3 py-2" />
      <div className="flex gap-2">
        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
          Currency
          <select name="currency" required defaultValue="" className="rounded-md border border-border px-3 py-2">
            <option value="" disabled>
              Select
            </option>
            <option value="GHS">GHS</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
          Amount
          <input type="number" name="amount" min="0.01" step="0.01" required className="rounded-md border border-border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
          Billing interval
          <select name="billingInterval" defaultValue="monthly" className="rounded-md border border-border px-3 py-2">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit">Create subscription</Button>
    </form>
  );
}
