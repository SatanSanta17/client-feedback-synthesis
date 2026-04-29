// ---------------------------------------------------------------------------
// Streaming Store — module-level singleton owning all stream state (PRD-024)
// ---------------------------------------------------------------------------
// Map<conversationId, slice> + Set<listener> + Map<conversationId, AbortController>.
// Consumed via useSyncExternalStore in streaming-hooks.ts. Mutated via
// streaming-actions.ts. No React imports — framework-agnostic.
// ---------------------------------------------------------------------------

import type { ConversationStreamSlice } from "./streaming-types";

type Listener = () => void;

const slices = new Map<string, ConversationStreamSlice>();
const listeners = new Set<Listener>();
const abortControllers = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

// ---------------------------------------------------------------------------
// Slice access
// ---------------------------------------------------------------------------

export function getSlice(id: string): ConversationStreamSlice | undefined {
  return slices.get(id);
}

/**
 * Merge a partial update into the slice for `id`. The id is the authoritative
 * source of `conversationId` — callers don't repeat it in the partial. On the
 * first call for an id, the partial must include enough fields to hydrate a
 * full slice (callers spread `IDLE_SLICE_DEFAULTS` on first call).
 */
export function setSlice(
  id: string,
  partial: Partial<Omit<ConversationStreamSlice, "conversationId">>
): void {
  const current = slices.get(id);
  const next = {
    ...current,
    ...partial,
    conversationId: id,
  } as ConversationStreamSlice;
  // Footgun trap: a first call for `id` must seed every required field
  // (callers spread IDLE_SLICE_DEFAULTS). If a future caller forgets the
  // spread, the cast above silently produces an incomplete slice. Catch
  // it here at first run instead of when a downstream subscriber crashes.
  if (
    !current &&
    (next.streamState === undefined || next.startedAt === undefined)
  ) {
    console.warn(
      `[streaming-store] setSlice incomplete-seed for ${id} — missing required fields. Caller likely forgot to spread IDLE_SLICE_DEFAULTS.`
    );
  }
  slices.set(id, next);
  notify();
}

// ---------------------------------------------------------------------------
// Selectors (PRD-024 Part 6 — predicate consolidation)
// ---------------------------------------------------------------------------

/**
 * Predicate factory: matches slices that are actively streaming in the
 * given workspace. Used by both the cap defense in streaming-actions.ts
 * and the React hook layer in streaming-hooks.ts so the workspace +
 * streaming-state filter has exactly one source of truth.
 */
export function isStreamingForTeam(
  teamId: string | null
): (slice: ConversationStreamSlice) => boolean {
  return (slice) =>
    slice.teamId === teamId && slice.streamState === "streaming";
}

/**
 * Predicate factory: matches slices in the given workspace that have a
 * completed/cancelled response not yet viewed (PRD-024 P4.R2). Symmetric
 * with `isStreamingForTeam` — both predicates are complete filters
 * (workspace + state), keeping the iteration helper generic.
 */
export function hasUnseenCompletionForTeam(
  teamId: string | null
): (slice: ConversationStreamSlice) => boolean {
  return (slice) =>
    slice.teamId === teamId && slice.hasUnseenCompletion;
}

/**
 * Generic iteration + filter over the slices Map. Single allocation per
 * call; caller specializes via predicate. Bounded by the active-stream
 * cap (5 in practice) so the array is always tiny.
 */
export function findSlicesWhere(
  predicate: (slice: ConversationStreamSlice) => boolean
): ConversationStreamSlice[] {
  const out: ConversationStreamSlice[] = [];
  for (const slice of slices.values()) {
    if (predicate(slice)) out.push(slice);
  }
  return out;
}

/**
 * Count slices matching a predicate without allocating an intermediate
 * array. Used by primitive-selector hooks (`useActiveStreamCount`) so
 * subscribers don't re-render when the matching set's *contents* change
 * but the count stays the same — `useSyncExternalStore`'s Object.is
 * bailout works on the primitive number.
 */
export function countSlicesWhere(
  predicate: (slice: ConversationStreamSlice) => boolean
): number {
  let count = 0;
  for (const slice of slices.values()) {
    if (predicate(slice)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// AbortController access
// ---------------------------------------------------------------------------

export function setAbortController(
  id: string,
  controller: AbortController
): void {
  abortControllers.set(id, controller);
}

export function getAbortController(id: string): AbortController | undefined {
  return abortControllers.get(id);
}

export function deleteAbortController(id: string): void {
  abortControllers.delete(id);
}

// ---------------------------------------------------------------------------
// Hard reset (Part 5: sign-out teardown)
// ---------------------------------------------------------------------------

/**
 * Aborts every in-flight stream, drops every slice, notifies subscribers.
 * After return, the store is empty and all listeners have observed the change.
 */
export function clearAll(): void {
  for (const ctrl of abortControllers.values()) ctrl.abort();
  abortControllers.clear();
  slices.clear();
  notify();
}
