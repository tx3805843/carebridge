import { requireStaffUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staffUser = await requireStaffUser();

  return <AppShell user={staffUser}>{children}</AppShell>;
}
