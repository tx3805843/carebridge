import Link from "next/link";
import { Button, buttonVariants } from "@carebridge/ui";
import { requireStaffUser } from "@/lib/auth";
import { signOut } from "./logout/actions";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ onboarded?: string; visitScheduled?: string }>;
}) {
  const staffUser = await requireStaffUser();
  const { onboarded, visitScheduled } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-24">
      <h1 className="text-2xl font-semibold">CareBridge Ops Console</h1>
      <p className="text-muted-foreground">
        Signed in as {staffUser.fullName} ({staffUser.roleLabel})
      </p>
      {onboarded ? (
        <p className="text-sm text-emerald-700">Client onboarded (id {onboarded}).</p>
      ) : null}
      {visitScheduled ? <p className="text-sm text-emerald-700">Visit scheduled.</p> : null}
      <div className="flex gap-3">
        <Link href="/clients/new" className={buttonVariants()}>
          Onboard a new client
        </Link>
        <Link href="/visits/new" className={buttonVariants()}>
          Schedule a visit
        </Link>
        <Link href="/visits/log" className={buttonVariants()}>
          Log a visit
        </Link>
        <Link href="/roster" className={buttonVariants({ variant: "outline" })}>
          Roster
        </Link>
        <Link href="/exceptions" className={buttonVariants({ variant: "outline" })}>
          Exception queue
        </Link>
        <Link href="/staff/invite" className={buttonVariants({ variant: "outline" })}>
          Invite staff
        </Link>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </main>
  );
}
