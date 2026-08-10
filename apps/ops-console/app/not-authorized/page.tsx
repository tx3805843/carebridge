export default function NotAuthorizedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-24">
      <h1 className="text-2xl font-semibold">Not authorized</h1>
      <p className="text-muted-foreground">
        This console is for coordinator, clinical director, and admin accounts.
      </p>
    </main>
  );
}
