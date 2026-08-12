import Link from "next/link";
import { PageHeader } from "@carebridge/ui";
import { createClient } from "@/lib/supabase/server";
import { NewClientForm } from "./client-form";

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; onboarded?: string }>;
}) {
  const { error, onboarded } = await searchParams;

  const supabase = await createClient();
  const { data: zones } = await supabase.from("zone").select("id, name").order("name");

  return (
    <>
    <PageHeader title="Onboard a new client" />
    {onboarded ? (
      <p className="mb-4 text-sm text-success">
        Client onboarded.{" "}
        <Link href={`/clients/${onboarded}`} className="underline">
          Open client record
        </Link>
      </p>
    ) : null}
    <NewClientForm zones={zones ?? []} error={error} />
    </>
  );
}
