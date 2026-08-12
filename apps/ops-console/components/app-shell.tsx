"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, cn, ToastProvider, useToast, type ToastVariant } from "@carebridge/ui";
import { signOut } from "@/app/logout/actions";

// Persistent navigation spine — the UX review's #1 finding: "each route works in isolation... a
// user cannot see where they are." Every staff-gated page should wrap its content in this, not
// render its own full-page <main>. Rollout is in progress route-by-route (see roadmap Increment A).
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/exceptions", label: "Exception queue" },
  { href: "/clients/new", label: "Onboard client" },
  { href: "/visits/new", label: "Schedule visit" },
  { href: "/visits/log", label: "Log visit" },
  { href: "/roster", label: "Roster" },
  { href: "/providers", label: "Providers" },
  { href: "/billing", label: "Billing" },
  { href: "/staff/invite", label: "Staff accounts" },
];

export function AppShell({
  user,
  children,
}: {
  user: { fullName: string; roleLabel: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <aside className="flex w-60 shrink-0 flex-col gap-1 bg-brand-800 p-4 text-white">
          <Link href="/dashboard" className="mb-4 px-2 text-sm font-semibold tracking-wide">
            CareBridge Ops
          </Link>
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-white/15 font-medium text-white" : "text-white/75 hover:bg-white/10 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </aside>
        <div className="flex flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
            <span className="text-sm text-muted-foreground">
              Signed in as {user.fullName} ({user.roleLabel})
            </span>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </header>
          <main className="flex-1 overflow-y-auto p-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

// Render as a child anywhere within a page wrapped by AppShell (e.g. via app/(app)/layout.tsx)
// — fires once on mount for low-stakes confirmations only (see packages/ui's toast.tsx doc
// comment on when NOT to use this). Works because it only needs ToastProvider's context, which
// AppShell already establishes above it in the tree; it doesn't need to be a direct child.
export function ToastEffect({ toast }: { toast?: { message: string; variant?: ToastVariant } }) {
  const { showToast } = useToast();
  const shown = React.useRef(false);

  React.useEffect(() => {
    if (toast && !shown.current) {
      shown.current = true;
      showToast(toast.message, toast.variant);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.message]);

  return null;
}
