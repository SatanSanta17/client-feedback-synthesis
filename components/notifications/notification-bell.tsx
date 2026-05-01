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

interface NotificationBellProps {
  /** When true, hide the inline label (sidebar collapsed). */
  collapsed?: boolean;
  /** Called when the popover opens or closes — the sidebar uses this to
   *  keep the expand state stable while the popover is up. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Bell trigger + popover composition. The popover content (`NotificationDropdown`)
 * unmounts when the popover closes — the inner `useNotifications` fetch only
 * runs when the user opens the bell.
 */
export function NotificationBell({
  collapsed = false,
  onOpenChange,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { count, refetch } = useUnreadCount();
  // PRD-029 §P6.R1 — session boundary captured once on bell mount. The bell
  // is sidebar-mounted and persists across soft client navigation, so this
  // value only resets on a hard reload, new tab, or browser restart.
  const [sessionStartedAt] = useState(() => Date.now());

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      onOpenChange?.(open);
    },
    [onOpenChange]
  );
  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  const ariaLabel =
    count > 0 ? `Notifications, ${count} unread` : "Notifications";
  const displayCount =
    count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(count);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={collapsed ? "Notifications" : undefined}
          className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
        >
          <span className="relative flex shrink-0 items-center justify-center">
            <Bell className="size-5 shrink-0" />
            {count > 0 && (
              <span
                aria-live="polite"
                aria-atomic="true"
                className={cn(
                  "absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-tight",
                  "bg-[var(--brand-primary)] text-white ring-2 ring-[var(--surface-page)]"
                )}
              >
                {displayCount}
              </span>
            )}
          </span>
          <span
            className={cn(
              "truncate transition-opacity duration-200",
              collapsed
                ? "pointer-events-none w-0 overflow-hidden opacity-0"
                : "opacity-100"
            )}
          >
            Notifications
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={8} className="w-96 p-3">
        <NotificationDropdown
          sessionStartedAt={sessionStartedAt}
          onUnreadCountRefetch={refetch}
          onClose={close}
        />
      </PopoverContent>
    </Popover>
  );
}
