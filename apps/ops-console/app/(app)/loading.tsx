export default function Loading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-32 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-32 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}
