"use client";

// ---------------------------------------------------------------------------
// useMarkNotificationRead — fire-and-forget mark-read mutations (PRD-029 Part 2)
// ---------------------------------------------------------------------------
// POSTs against /api/notifications/[id]/read and /api/notifications/mark-all-read.
// Failures are logged but not surfaced — the bell stays optimistic, and the
// next unread-count poll corrects any drift. Network errors should not produce
// user-visible interruptions for an action this trivial.
// ---------------------------------------------------------------------------

import { useCallback } from "react";

const LOG_PREFIX = "[useMarkNotificationRead]";

export interface UseMarkNotificationReadReturn {
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: (teamId?: string | null) => Promise<void>;
}

export function useMarkNotificationRead(): UseMarkNotificationReadReturn {
  const markRead = useCallback(async (notificationId: string) => {
    try {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "POST",
      });
      if (!res.ok) {
        console.warn(`${LOG_PREFIX} markRead — HTTP ${res.status}`);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} markRead failed:`, err);
    }
  }, []);

  const markAllRead = useCallback(async (teamId?: string | null) => {
    try {
      const res = await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teamId ? { teamId } : {}),
      });
      if (!res.ok) {
        console.warn(`${LOG_PREFIX} markAllRead — HTTP ${res.status}`);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} markAllRead failed:`, err);
    }
  }, []);

  return { markRead, markAllRead };
}
