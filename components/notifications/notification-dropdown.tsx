"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useMarkNotificationRead } from "@/lib/hooks/use-mark-notification-read";
import { useNotifications } from "@/lib/hooks/use-notifications";

import { NotificationEmptyState } from "./notification-empty-state";
import { NotificationRow } from "./notification-row";
import { NotificationSkeleton } from "./notification-skeleton";

interface NotificationDropdownProps {
  /** Imperative refetch on the badge counter — called after mark-read mutations. */
  onUnreadCountRefetch: () => Promise<void>;
  /** Close the popover (the bell owns its open state). */
  onClose: () => void;
}

export function NotificationDropdown({
  onUnreadCountRefetch,
  onClose,
}: NotificationDropdownProps) {
  const {
    rows,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    markRowReadLocally,
    markAllRowsReadLocally,
  } = useNotifications();
  const { markRead, markAllRead } = useMarkNotificationRead();

  const hasUnread = useMemo(
    () => rows.some((r) => r.readAt === null),
    [rows]
  );

  // Suppress the per-row workspace label when every visible row belongs to
  // the same team — single-workspace users (or single-workspace pages of
  // the bell) should not see noisy per-row labels (PRD §P2.R10).
  const showWorkspaceLabel = useMemo(() => {
    if (rows.length === 0) return false;
    const firstTeamId = rows[0].teamId;
    return rows.some((r) => r.teamId !== firstTeamId);
  }, [rows]);

  async function handleMarkAllRead() {
    markAllRowsReadLocally();
    await markAllRead();
    void onUnreadCountRefetch();
  }

  return (
    <div className="flex max-h-96 flex-col">
      <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
        {hasUnread && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs"
            onClick={handleMarkAllRead}
          >
            Mark all as read
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && rows.length === 0 ? (
          <NotificationSkeleton />
        ) : error ? (
          <p className="py-4 text-center text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <NotificationEmptyState />
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <NotificationRow
                key={row.id}
                notification={row}
                showWorkspaceLabel={showWorkspaceLabel}
                onLocalMarkRead={markRowReadLocally}
                onServerMarkRead={markRead}
                onUnreadCountRefetch={onUnreadCountRefetch}
                onClose={onClose}
              />
            ))}
            {hasMore && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={isLoadingMore}
                onClick={() => void loadMore()}
              >
                {isLoadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
