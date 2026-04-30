"use client";

// ---------------------------------------------------------------------------
// useUnreadCount — bell-badge realtime + polling hook (PRD-029 Parts 2 + 4)
// ---------------------------------------------------------------------------
// Realtime is the primary signal — the bell refetches the unread count
// within 1-2 seconds of any change to `workspace_notifications` the user
// has RLS visibility to. Polling at 5-minute cadence is a safety net for
// silent WebSocket drops (network blip the client misses, server restart,
// auth-token-refresh edge cases). Tab-hidden pauses the polling entirely;
// focus refetches immediately.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

import { useNotificationRealtime } from "@/lib/hooks/use-notification-realtime";

const LOG_PREFIX = "[useUnreadCount]";
// Realtime is primary; polling is the backstop for silent drops. 5 minutes
// is the bounded staleness window when Realtime fails — short enough that
// users do not miss notifications for hours, long enough that healthy tabs
// pay near-zero polling cost.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface UseUnreadCountReturn {
  count: number;
  /** Imperative refetch — used by the bell after marking rows read so the
   *  badge reflects the change before the next poll tick. */
  refetch: () => Promise<void>;
}

export function useUnreadCount(): UseUnreadCountReturn {
  const [count, setCount] = useState<number>(0);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fetch-generation counter — incremented per call. Stale fetches (a slow
  // mount-fetch returning after a fresh Realtime-triggered fetch already
  // wrote the latest count) are discarded by gen comparison so the badge
  // never regresses to an older snapshot.
  const generationRef = useRef(0);

  const fetchCount = useCallback(async () => {
    const myGen = ++generationRef.current;
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) {
        console.warn(`${LOG_PREFIX} fetch — HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { count: number };
      if (cancelledRef.current || myGen !== generationRef.current) return;
      setCount(data.count);
    } catch (err) {
      console.error(`${LOG_PREFIX} fetch failed:`, err);
    }
  }, []);

  // Realtime: any INSERT / UPDATE / DELETE on workspace_notifications the
  // user has RLS visibility to triggers an immediate refetch.
  useNotificationRealtime(fetchCount);

  useEffect(() => {
    cancelledRef.current = false;

    function clearTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function schedule() {
      clearTimer();
      if (document.visibilityState !== "visible") return;
      void fetchCount();
      timerRef.current = setTimeout(schedule, POLL_INTERVAL_MS);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") schedule();
      else clearTimer();
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelledRef.current = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchCount]);

  return { count, refetch: fetchCount };
}
