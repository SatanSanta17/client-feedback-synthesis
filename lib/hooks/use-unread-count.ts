"use client";

// ---------------------------------------------------------------------------
// useUnreadCount — bell-badge polling hook (PRD-029 Part 2)
// ---------------------------------------------------------------------------
// Polls /api/notifications/unread-count while the tab is visible; pauses when
// hidden; refetches on focus. Forward-compatible with Part 4: when Realtime
// lands, this hook's body changes but the public return shape does not.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

const LOG_PREFIX = "[useUnreadCount]";
const POLL_INTERVAL_MS = 30_000;

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

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) {
        console.warn(`${LOG_PREFIX} fetch — HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { count: number };
      if (!cancelledRef.current) setCount(data.count);
    } catch (err) {
      console.error(`${LOG_PREFIX} fetch failed:`, err);
    }
  }, []);

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
