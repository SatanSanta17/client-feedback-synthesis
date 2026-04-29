"use client";

// ---------------------------------------------------------------------------
// Streaming Hooks — useSyncExternalStore-backed subscriptions (PRD-024)
// ---------------------------------------------------------------------------
// Single-conversation hooks subscribe to one slice; aggregate hooks derive
// workspace-filtered lists from listSlices(). All aggregate hooks cache the
// last result keyed by teamId so getSnapshot returns a stable reference when
// nothing relevant changed (otherwise useSyncExternalStore's bailout breaks).
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

import { subscribe, getSlice, listSlices } from "./streaming-store";
import type { ConversationStreamSlice } from "./streaming-types";

// ---------------------------------------------------------------------------
// Single-conversation hooks
// ---------------------------------------------------------------------------

/**
 * Subscribe to one conversation's streaming slice. Returns null when the
 * conversation has no active slice (idle / never started).
 */
export function useStreamingSlice(
  id: string | null
): ConversationStreamSlice | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? getSlice(id) ?? null : null),
    () => null
  );
}

export function useIsStreaming(id: string | null): boolean {
  const slice = useStreamingSlice(id);
  return slice?.streamState === "streaming";
}

// ---------------------------------------------------------------------------
// Aggregate hooks (workspace-filtered)
// ---------------------------------------------------------------------------
// Standard pattern for derived snapshots over useSyncExternalStore: cache
// the last result by content equality so getSnapshot returns the same array
// reference when the derived data didn't change. Without this, every store
// notify would produce a new array and force every subscriber to re-render
// (defeats P1.R2's selective re-render requirement).
// ---------------------------------------------------------------------------

const activeStreamIdsCache = new Map<string | null, string[]>();

function computeActiveStreamIds(teamId: string | null): string[] {
  const out: string[] = [];
  for (const slice of listSlices().values()) {
    if (slice.teamId === teamId && slice.streamState === "streaming") {
      out.push(slice.conversationId);
    }
  }
  return out;
}

function stableActiveStreamIds(teamId: string | null): string[] {
  const cached = activeStreamIdsCache.get(teamId);
  const fresh = computeActiveStreamIds(teamId);
  if (
    cached &&
    cached.length === fresh.length &&
    cached.every((id, i) => id === fresh[i])
  ) {
    return cached;
  }
  activeStreamIdsCache.set(teamId, fresh);
  return fresh;
}

/**
 * IDs of conversations currently streaming in the given workspace. NULL =
 * personal workspace. Result reference is stable across notifies that don't
 * change the set.
 */
export function useActiveStreamIds(teamId: string | null): string[] {
  return useSyncExternalStore(
    subscribe,
    () => stableActiveStreamIds(teamId),
    () => []
  );
}

export function useActiveStreamCount(teamId: string | null): number {
  return useActiveStreamIds(teamId).length;
}

const unseenCompletionIdsCache = new Map<string | null, string[]>();

function computeUnseenCompletionIds(teamId: string | null): string[] {
  const out: string[] = [];
  for (const slice of listSlices().values()) {
    if (slice.teamId === teamId && slice.hasUnseenCompletion) {
      out.push(slice.conversationId);
    }
  }
  return out;
}

function stableUnseenCompletionIds(teamId: string | null): string[] {
  const cached = unseenCompletionIdsCache.get(teamId);
  const fresh = computeUnseenCompletionIds(teamId);
  if (
    cached &&
    cached.length === fresh.length &&
    cached.every((id, i) => id === fresh[i])
  ) {
    return cached;
  }
  unseenCompletionIdsCache.set(teamId, fresh);
  return fresh;
}

/**
 * IDs of conversations in the given workspace whose last stream completed
 * (or was cancelled with content) and hasn't yet been viewed. NULL = personal.
 */
export function useUnseenCompletionIds(teamId: string | null): string[] {
  return useSyncExternalStore(
    subscribe,
    () => stableUnseenCompletionIds(teamId),
    () => []
  );
}

export function useHasAnyUnseenCompletion(teamId: string | null): boolean {
  return useUnseenCompletionIds(teamId).length > 0;
}
