"use client";

// ---------------------------------------------------------------------------
// useNotifications — bell-list realtime + paginated fetch hook (PRD-029
// Parts 2 + 4)
// ---------------------------------------------------------------------------
// Owns the bell dropdown's row state: paginated fetch from
// /api/notifications, optimistic local mutations for mark-read, refresh on
// demand, Realtime-driven refresh on every change. The bell's
// NotificationBell lazy-mounts the dropdown content so this hook's effects
// only run when the user actually opens the popover — Realtime subscription
// is bell-open-scoped.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

import { useNotificationRealtime } from "@/lib/hooks/use-notification-realtime";
import type {
  BellNotificationRow,
  ListForBellResult,
} from "@/lib/repositories/notification-repository";
import type { NotificationCursor } from "@/lib/types/notification";

const LOG_PREFIX = "[useNotifications]";
const PAGE_LIMIT = 50;

export interface UseNotificationsReturn {
  rows: BellNotificationRow[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Refetch from the start (drops `rows`, reloads page 1). */
  refresh: () => Promise<void>;
  /** Append the next page using the current cursor. No-op when `hasMore` is false. */
  loadMore: () => Promise<void>;
  /** Optimistic local mutation — toggles `readAt` on a single row. The bell
   *  calls this immediately after firing the markRead POST so the UI reflects
   *  the change before the next unread-count poll. */
  markRowReadLocally: (id: string) => void;
  /** Optimistic local mutation — sets `readAt` on every currently-loaded
   *  unread row. Mirrors the server-side bulk mark-all-read. */
  markAllRowsReadLocally: () => void;
}

export function useNotifications(): UseNotificationsReturn {
  const [rows, setRows] = useState<BellNotificationRow[]>([]);
  const [cursor, setCursor] = useState<NotificationCursor | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  // Fetch-generation counter — incremented per call. Stale responses
  // (e.g., a load-more page-2 append racing a Realtime-triggered refresh
  // page-1 fetch) are discarded by gen comparison; only the latest fetch
  // mutates row state.
  const generationRef = useRef(0);

  const fetchPage = useCallback(
    async (pageCursor: NotificationCursor | null): Promise<void> => {
      const myGen = ++generationRef.current;
      const isFirstPage = pageCursor === null;
      if (isFirstPage) setIsLoading(true);
      else setIsLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_LIMIT));
        if (pageCursor) {
          params.set("cursor", pageCursor.createdAt);
          params.set("cursorId", pageCursor.id);
        }
        const res = await fetch(`/api/notifications?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ListForBellResult;
        if (cancelledRef.current || myGen !== generationRef.current) return;
        setRows((prev) => (isFirstPage ? data.rows : [...prev, ...data.rows]));
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      } catch (err) {
        if (cancelledRef.current || myGen !== generationRef.current) return;
        // Log the raw error for debugging; surface a friendly message to the
        // user (raw `err.message` is often "HTTP 500" / "Failed to fetch" —
        // not useful in a dropdown).
        console.error(`${LOG_PREFIX} fetch failed:`, err);
        setError("Failed to load notifications");
      } finally {
        if (!cancelledRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    []
  );

  const refresh = useCallback(() => fetchPage(null), [fetchPage]);

  // Realtime: any change on workspace_notifications the user can see triggers
  // a fresh page-1 fetch. Subscription is bell-open-scoped — when the dropdown
  // is closed this hook is unmounted (Part 2 lazy-mount via Radix Portal) and
  // no subscription exists.
  useNotificationRealtime(refresh);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor) return;
    await fetchPage(cursor);
  }, [fetchPage, hasMore, cursor]);

  const markRowReadLocally = useCallback((id: string) => {
    const now = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) =>
        r.id === id && r.readAt === null ? { ...r, readAt: now } : r
      )
    );
  }, []);

  const markAllRowsReadLocally = useCallback(() => {
    const now = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) => (r.readAt === null ? { ...r, readAt: now } : r))
    );
  }, []);

  // Initial load — runs when the hook mounts. The bell's NotificationBell
  // lazy-mounts the dropdown's contents so this effect only fires when the
  // user opens the popover.
  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  return {
    rows,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
    markRowReadLocally,
    markAllRowsReadLocally,
  };
}
