// A specimen of what the product does: an answer, its citation, and the passage it came from with
// the cited sentence highlighted. The text is illustrative, and the caption says so.
export function AuthExample() {
  return (
    <figure className="max-w-xl">
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="px-6 pb-6 pt-5">
          <p className="text-sm text-muted-foreground">How many vacation days do I get?</p>
          <p className="mt-3 font-serif text-xl leading-relaxed">
            Full-time employees get 25 days of paid annual{" "}
            <span className="whitespace-nowrap">
              leave
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1 align-[0.2em] font-sans text-xs font-medium text-primary">
                1
              </span>
              ,
            </span>{" "}
            counted per calendar year.
          </p>
        </div>

        <div className="border-t bg-muted/50 px-6 py-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1 text-xs font-medium text-primary">
              1
            </span>
            Employee handbook, page 12
          </p>
          <p className="mt-3 font-serif text-base leading-relaxed text-foreground/85">
            4.2 Annual leave. Full-time employees are entitled to{" "}
            <mark className="cite-mark px-0.5">25 days of paid annual leave</mark> per calendar year. Part-time staff
            receive leave in proportion to their hours.
          </p>
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-muted-foreground">An example answer and the passage it came from.</figcaption>
    </figure>
  );
}
