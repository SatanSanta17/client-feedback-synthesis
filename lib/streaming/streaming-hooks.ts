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

/**
 * True iff this conversation's slice is currently in the streaming state.
 * Uses a primitive selector so subscribers to conversation A don't re-render
 * on deltas in conversation B (the boolean snapshot is reference-compared
 * by useSyncExternalStore's bailout).
 */
export function useIsStreaming(id: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (id ? getSlice(id)?.streamState === "streaming" : false),
    () => false
  );
}

/**
 * True iff this conversation has a completed/cancelled response that the
 * user hasn't yet viewed (PRD-024 P4.R2). Cleared by `markConversationViewed`,
 * called by useChat's fold on in-view completion AND by chat-page-content
 * on navigation into the conversation. Same primitive-selector shape as
 * useIsStreaming for selective re-rendering across many sidebar items.
 */
export function useHasUnseenCompletion(id: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (id ? getSlice(id)?.hasUnseenCompletion ?? false : false),
    () => false
  );
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

type SlicePredicate = (slice: ConversationStreamSlice) => boolean;

/**
 * Generic stable-ref derivation over the slice store. Used by aggregate hooks
 * that filter slices by workspace + a per-slice predicate. The cache is keyed
 * by teamId; identical fresh results return the cached array reference so
 * useSyncExternalStore's bailout works.
 */
function stableFilteredIds(
  cache: Map<string | null, string[]>,
  teamId: string | null,
  predicate: SlicePredicate
): string[] {
  const fresh: string[] = [];
  for (const slice of listSlices().values()) {
    if (slice.teamId === teamId && predicate(slice)) {
      fresh.push(slice.conversationId);
    }
  }
  const cached = cache.get(teamId);
  if (
    cached &&
    cached.length === fresh.length &&
    cached.every((id, i) => id === fresh[i])
  ) {
    return cached;
  }
  cache.set(teamId, fresh);
  return fresh;
}

const activeStreamIdsCache = new Map<string | null, string[]>();
const isStreamingPredicate: SlicePredicate = (s) => s.streamState === "streaming";

/**
 * IDs of conversations currently streaming in the given workspace. NULL =
 * personal workspace. Result reference is stable across notifies that don't
 * change the set.
 */
export function useActiveStreamIds(teamId: string | null): string[] {
  return useSyncExternalStore(
    subscribe,
    () => stableFilteredIds(activeStreamIdsCache, teamId, isStreamingPredicate),
    () => []
  );
}

export function useActiveStreamCount(teamId: string | null): number {
  return useActiveStreamIds(teamId).length;
}

const unseenCompletionIdsCache = new Map<string | null, string[]>();
const hasUnseenPredicate: SlicePredicate = (s) => s.hasUnseenCompletion;

/**
 * IDs of conversations in the given workspace whose last stream completed
 * (or was cancelled with content) and hasn't yet been viewed. NULL = personal.
 */
export function useUnseenCompletionIds(teamId: string | null): string[] {
  return useSyncExternalStore(
    subscribe,
    () => stableFilteredIds(unseenCompletionIdsCache, teamId, hasUnseenPredicate),
    () => []
  );
}

export function useHasAnyUnseenCompletion(teamId: string | null): boolean {
  return useUnseenCompletionIds(teamId).length > 0;
}
