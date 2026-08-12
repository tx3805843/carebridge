import Link from "next/link";
import { buttonVariants } from "@carebridge/ui";

export default function AppNotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        The page or record you&apos;re looking for doesn&apos;t exist, or may have been removed.
      </p>
      <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
        Back to dashboard
      </Link>
    </div>
  );
}
