"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { renderNotification } from "@/lib/notifications/renderers";
import type { BellNotificationRow } from "@/lib/repositories/notification-repository";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format-relative-time";

interface NotificationRowProps {
  notification: BellNotificationRow;
  /** Show the workspace label. The dropdown computes this once per render
   *  based on whether the visible rows span multiple teams. */
  showWorkspaceLabel: boolean;
  /** Optimistic local mark-read. */
  onLocalMarkRead: (id: string) => void;
  /** Fire the server-side mark-read POST. */
  onServerMarkRead: (id: string) => Promise<void>;
  /** Refresh the unread badge after a server-side mutation. */
  onUnreadCountRefetch: () => Promise<void>;
  /** Close the popover after navigation. */
  onClose: () => void;
}

export function NotificationRow({
  notification,
  showWorkspaceLabel,
  onLocalMarkRead,
  onServerMarkRead,
  onUnreadCountRefetch,
  onClose,
}: NotificationRowProps) {
  const router = useRouter();
  const { activeTeamId, setActiveTeam } = useAuth();
  const rendered = renderNotification(notification);
  const Icon = rendered.icon;
  const isUnread = notification.readAt === null;

  const handleClick = useCallback(async () => {
    // 1. Optimistic local mark-read + fire-and-forget server mark-read.
    if (isUnread) {
      onLocalMarkRead(notification.id);
      void onServerMarkRead(notification.id);
      void onUnreadCountRefetch();
    }

    // 2. Cross-workspace switch if needed (PRD §P2.R10). Switching first
    // ensures the destination renders in the correct workspace context,
    // preventing a flash of "no data" on the destination page.
    if (notification.teamId !== activeTeamId) {
      setActiveTeam(notification.teamId);
    }

    // 3. Navigate to the deep-link, or close the popover when there isn't one.
    if (rendered.deepLink) {
      router.push(rendered.deepLink);
    }
    onClose();
  }, [
    isUnread,
    notification.id,
    notification.teamId,
    activeTeamId,
    setActiveTeam,
    rendered.deepLink,
    router,
    onLocalMarkRead,
    onServerMarkRead,
    onUnreadCountRefetch,
    onClose,
  ]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-start gap-3 rounded-md p-2 text-left transition-colors hover:bg-accent"
    >
      <span className="relative flex shrink-0 items-center justify-center pt-0.5">
        <Icon
          className={cn(
            "size-5",
            isUnread ? "text-foreground" : "text-muted-foreground"
          )}
        />
        {isUnread && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-[var(--brand-primary)]"
          />
        )}
      </span>
      <span className="flex flex-1 flex-col gap-0.5 min-w-0">
        <span
          className={cn(
            "text-sm",
            isUnread ? "font-medium text-foreground" : "text-muted-foreground"
          )}
        >
          {rendered.title}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{formatRelativeTime(notification.createdAt)}</span>
          {showWorkspaceLabel && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{notification.teamName}</span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}
