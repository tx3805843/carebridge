import { Button } from "@carebridge/ui";
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-24">
      <h1 className="text-2xl font-semibold">CareBridge Ops Console</h1>
      <form action={signIn} className="flex w-full max-w-sm flex-col gap-3">
        <input
          type="email"
          name="email"
          placeholder="Email"
          required
          className="rounded-md border border-border px-3 py-2"
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          required
          className="rounded-md border border-border px-3 py-2"
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit">Sign in</Button>
      </form>
    </main>
  );
}
