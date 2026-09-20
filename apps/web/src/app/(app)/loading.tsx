import { Skeleton } from "@/components/ui/skeleton";

// Shown while a page in the app loads. Shaped like the Documents page: title block, count line, table rows.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-5 w-56" />
      <Skeleton className="mt-2 h-4 w-72" />
      <Skeleton className="mb-3 mt-8 h-4 w-24" />
      <div className="space-y-px overflow-hidden rounded-lg border">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
