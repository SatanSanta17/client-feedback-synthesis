/** Three-row pulsing placeholder shown during the bell's initial fetch.
 *  Avoids introducing a shared `<Skeleton>` primitive — local Tailwind tokens
 *  cover this single use site (PRD-029 §P2.R9: no new design tokens). */
export function NotificationSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex animate-pulse items-start gap-3 rounded-md p-2"
        >
          <div className="size-5 shrink-0 rounded-full bg-muted" />
          <div className="flex-1 space-y-2 py-0.5">
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-2 w-1/3 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
