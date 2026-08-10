import { redirect } from "next/navigation";
import { requireStaffUser } from "@/lib/auth";

// The button-strip home page is retired in favor of the persistent nav shell (see
// components/app-shell.tsx) — every destination it used to link to is now always visible in the
// sidebar, so "/" just lands staff on the daily-cockpit dashboard instead of an intermediate menu.
export default async function Home() {
  await requireStaffUser();
  redirect("/dashboard");
}
