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
  slices.set(id, {
    ...current,
    ...partial,
    conversationId: id,
  } as ConversationStreamSlice);
  notify();
}

/**
 * Read-only snapshot of all slices. Aggregate hooks iterate this to derive
 * workspace-filtered lists (active streams, unseen completions).
 */
export function listSlices(): ReadonlyMap<string, ConversationStreamSlice> {
  return slices;
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
