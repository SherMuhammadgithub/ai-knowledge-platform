import { Skeleton } from "@/components/ui/skeleton";

// Shaped like the members page: title block, count line, table rows.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading members">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-5 w-64" />
      <Skeleton className="mb-3 mt-8 h-4 w-20" />
      <div className="space-y-px overflow-hidden rounded-lg border">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
