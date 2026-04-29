"use client";

import { useCallback, useState } from "react";
import { Bell } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { cn } from "@/lib/utils";

import { NotificationDropdown } from "./notification-dropdown";

const UNREAD_BADGE_CAP = 9;

/**
 * Bell trigger + popover composition. The popover content (`NotificationDropdown`)
 * unmounts when the popover closes — the inner `useNotifications` fetch only
 * runs when the user actually opens the bell.
 */
export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const { count, refetch } = useUnreadCount();

  const close = useCallback(() => setIsOpen(false), []);

  const ariaLabel =
    count > 0 ? `Notifications, ${count} unread` : "Notifications";
  const displayCount =
    count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(count);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="relative flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bell className="size-5" />
          {count > 0 && (
            <span
              aria-live="polite"
              className={cn(
                "absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-tight",
                "bg-[var(--brand-primary)] text-white ring-2 ring-[var(--surface-page)]"
              )}
            >
              {displayCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-96 p-3">
        <NotificationDropdown
          onUnreadCountRefetch={refetch}
          onClose={close}
        />
      </PopoverContent>
    </Popover>
  );
}
