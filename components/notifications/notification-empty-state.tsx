import { BellOff } from "lucide-react";

export function NotificationEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <BellOff className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm text-muted-foreground">
        You&apos;re all caught up
      </p>
    </div>
  );
}
