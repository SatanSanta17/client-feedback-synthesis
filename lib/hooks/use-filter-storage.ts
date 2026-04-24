"use client";

import { useCallback, useMemo } from "react";

import { useAuth } from "@/components/providers/auth-provider";

// ---------------------------------------------------------------------------
// useFilterStorage — sessionStorage-backed filter persistence primitive
// ---------------------------------------------------------------------------
// Keys filter state by user + active workspace so that:
//   1. Filters survive navigation within a browser session.
//   2. Each workspace remembers its own filters.
//   3. Users on a shared tab never read each other's filter state
//      (userId is part of the key).
//   4. No cleanup-on-signOut is required — tab close wipes sessionStorage,
//      and stale keys from prior users are inert due to userId isolation.
//
// Surfaces consume this primitive directly and decide their own sync policy
// (URL-based or local-state-based). Intentionally narrow.
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[useFilterStorage]";

interface UseFilterStorageReturn<T> {
  /** Stable sessionStorage key; null until the user is loaded. */
  key: string | null;
  /** Read the stored value; returns null when unavailable or unset. */
  read: () => T | null;
  /** Write a value; no-op until the user is loaded. */
  write: (value: T) => void;
}

export function useFilterStorage<T>(
  surface: string
): UseFilterStorageReturn<T> {
  const { user, activeTeamId } = useAuth();

  const key = useMemo<string | null>(() => {
    if (!user) return null;
    const workspace = activeTeamId ?? "personal";
    return `filters:${surface}:${user.id}:${workspace}`;
  }, [surface, user, activeTeamId]);

  const read = useCallback((): T | null => {
    if (!key || typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.warn(`${LOG_PREFIX} read failed for ${key}: ${msg}`);
      return null;
    }
  }, [key]);

  const write = useCallback(
    (value: T) => {
      if (!key || typeof window === "undefined") return;
      try {
        window.sessionStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(`${LOG_PREFIX} write failed for ${key}: ${msg}`);
      }
    },
    [key]
  );

  // Stable return reference — otherwise consumers with `filterStorage` in
  // effect deps re-run every render.
  return useMemo(() => ({ key, read, write }), [key, read, write]);
}
