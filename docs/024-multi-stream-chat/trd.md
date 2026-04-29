# TRD-024: Multi-Stream Chat Architecture

> **Note on scope.** This TRD is being written one part at a time per CLAUDE.md. Part 1 is detailed below; Parts 2–7 will be drafted as each preceding part lands. Forward-compatibility notes inside each part reference later parts where relevant.

---

## Architectural Foundation (cross-part)

Decisions that span the whole PRD. Captured here so each part can reference them without re-explaining.

### Industry pattern: `useSyncExternalStore` over a module-level store

The PRD uses the word "context" conceptually — meaning *the streaming state owner module* — not the React Context API. The implementation is a **module-level singleton store** (a `Map<conversationId, slice>` plus a `Set<listener>`) consumed via React 18's built-in `useSyncExternalStore` hook. This is the same primitive Zustand, Jotai, and Valtio use internally; it's the canonical pattern when you need:

- Fine-grained subscriptions to a keyed external state.
- Stable references for unchanged keys, so subscribers bail out of re-renders when their slice didn't change.
- No `<Provider>` boilerplate or context tree.

**Why not a React Context.** A plain `React.createContext` broadcasts to *every* consumer on every change — which would re-render conversation A's chat-area on every delta in conversation B. Violates P1.R2.

**Why not Redux/Zustand.** CLAUDE.md mandates "React hooks only. No Redux, Zustand, or external state libraries." `useSyncExternalStore` gives us the same selector-equality semantics in ~100 LOC of project code with no dependency.

**Selective re-render mechanism.** When the store mutates, every listener fires (broadcast). But each subscriber's `getSnapshot()` returns the *same reference* if its slice didn't change — React then bails out of the render. Net effect: subscribers wake up briefly to compare a reference, then no-op. This satisfies P1.R2.

### Module-level store, not a Provider component

The streaming store is a singleton module — `import { startStream } from '@/lib/streaming'`. There is no `<StreamingProvider>` component. P1.R4's "mounted at app root" is satisfied conceptually by the module being app-wide accessible. Sign-out teardown is an explicit imperative call from `auth-provider.signOut()` — no lifecycle component required.

### File layout

```
lib/streaming/
├── streaming-types.ts       # ConversationStreamSlice, StartStreamArgs, IDLE_SLICE_DEFAULTS
├── streaming-store.ts       # Map + listener Set, subscribe/getSlice/setSlice + abortControllers map
├── streaming-actions.ts     # startStream, cancelStream, markConversationViewed, clearAllStreams (SSE loop lives here)
├── streaming-hooks.ts       # All useSyncExternalStore-backed hooks
└── index.ts                 # Barrel — public API surface
```

`lib/streaming/` is the canonical location. Future parts (2, 3, 6) consume from `@/lib/streaming` only.

### Slice shape (forward-compat across all parts)

The `ConversationStreamSlice` is designed in Part 1 to carry every field that any later part needs, even if unused at first. Adding fields later means schema migration headaches; designing right once is cheap.

```ts
interface ConversationStreamSlice {
  conversationId: string;
  teamId: string | null;            // Part 5: workspace filtering
  streamState: StreamState;         // 'idle' | 'streaming' | 'error' (existing type from lib/types/chat.ts)
  streamingContent: string;
  statusText: string | null;
  latestSources: ChatSource[] | null;
  latestFollowUps: string[];
  error: string | null;
  assistantMessageId: string | null;
  hasUnseenCompletion: boolean;     // Part 4 R2: solid dot
  finalMessage: Message | null;     // Part 2 R3 / P2.R7: handed off to useChat on streaming→idle transition
  startedAt: number;                // ms epoch — for ordering, debug, and stale-stream detection
}
```

`AbortController` instances are non-serializable and live in a separate module-level `Map<conversationId, AbortController>` inside `streaming-store.ts` — they don't appear on the slice.

### Public API surface (forward-compat)

The module's exports designed in Part 1 are stable across the whole PRD:

```ts
// imperative — Part 2/3 will call these
export function startStream(args: StartStreamArgs): void;
export function cancelStream(conversationId: string): void;
export function markConversationViewed(conversationId: string): void; // Part 4
export function clearAllStreams(): void;                              // Part 5 (sign-out)

// hooks — Part 2/3/4/5 will subscribe via these
export function useStreamingSlice(id: string | null): ConversationStreamSlice | null;
export function useIsStreaming(id: string | null): boolean;
export function useActiveStreamIds(teamId: string | null): string[];
export function useActiveStreamCount(teamId: string | null): number;       // Part 4 footer text + Part 3 cap
export function useUnseenCompletionIds(teamId: string | null): string[];   // Part 4 R2 dots
export function useHasAnyUnseenCompletion(teamId: string | null): boolean; // Part 5 R2 AppSidebar solid dot
```

---

# Part 1
## Part 1 — Streaming Context Foundation

This part covers P1.R1 through P1.R5 from the PRD. Pure scaffolding: the streaming module is built end-to-end (store, SSE loop, hooks, sign-out teardown) but **no consumer calls it yet**. The legacy `useChat` continues to own the SSE loop and message list. Part 2 will migrate consumers.

**Database models:** None.
**API endpoints:** None.
**Frontend pages/components:** No page or component changes. `auth-provider.tsx` is the only touched UI file (one line in `signOut`).
**New module:** `lib/streaming/` (4 source files + barrel).
**Refactor target:** `lib/utils/chat-helpers.ts` (extract two pure helpers from `use-chat.ts`).

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Extract SSE utilities into `chat-helpers.ts` | Move `parseSSEChunk`, `stripFollowUpBlock`, follow-up regex constants from `use-chat.ts` to `lib/utils/chat-helpers.ts`; legacy hook re-imports them | small, refactor-only |
| 2 | Streaming module — types, store, actions, hooks | `lib/streaming/*` — full module built; no consumer wires it yet | medium |
| 3 | Sign-out teardown wiring | One-line addition to `auth-provider.signOut`; smoke test of legacy chat flow | tiny |

Each increment is independently shippable. Increments 2 and 3 may be bundled if reviewer prefers fewer PRs.

---

### Increment 1 — Extract SSE utilities (P1 prerequisite)

**What:** Move the SSE chunk parser and the follow-up-block stripper from inline definitions inside `use-chat.ts` to `lib/utils/chat-helpers.ts`. Pure refactor — behavior unchanged. This pre-empts Part 6's P6.R2 ("SSE parsing and follow-up extraction live in one place") for the parser module so Increment 2's SSE loop can import the same helpers as legacy `useChat`, avoiding a transient duplicate.

**Files changed:**

| File | Action |
|------|--------|
| `lib/utils/chat-helpers.ts` | **Modify** — add three exports: `parseSSEChunk`, `stripFollowUpBlock`, plus the two regex constants `FOLLOW_UP_COMPLETE_RE` / `FOLLOW_UP_PARTIAL_RE` (kept module-private; only the two helpers are exported) |
| `lib/hooks/use-chat.ts` | **Modify** — delete the inline `parseSSEChunk` (lines 117–153), `stripFollowUpBlock` (lines 31–37), and the regex constants (lines 28–29); replace with imports from `chat-helpers.ts` |

**Implementation details:**

1. **Add to `chat-helpers.ts`.** Append the existing definitions verbatim. The `SSEEvent` interface moves with `parseSSEChunk` (also exported).

   ```ts
   // chat-helpers.ts additions
   export interface SSEEvent {
     event: string;
     data: string;
   }

   export function parseSSEChunk(buffer: string): { events: SSEEvent[]; remaining: string } {
     // body unchanged from use-chat.ts:117–153
   }

   const FOLLOW_UP_COMPLETE_RE = /<!--follow-ups:(\[[\s\S]*?\])-->/;
   const FOLLOW_UP_PARTIAL_RE = /<!--follow-ups:[\s\S]*$/;

   export function stripFollowUpBlock(text: string): string {
     const complete = text.replace(FOLLOW_UP_COMPLETE_RE, "").trimEnd();
     if (complete !== text) return complete;
     return text.replace(FOLLOW_UP_PARTIAL_RE, "").trimEnd();
   }
   ```

2. **Update `use-chat.ts`.** Replace the import block (lines 12–14) with the additional helpers:

   ```ts
   import {
     parseFollowUps,
     parseSSEChunk,
     stripFollowUpBlock,
   } from "@/lib/utils/chat-helpers";
   ```

   Delete lines 28–37 (regex constants + `stripFollowUpBlock`) and lines 108–153 (`SSEEvent` + `parseSSEChunk`). The call sites (`use-chat.ts:424` and `:448`) are unchanged.

**Verify:**

- `grep -rn "FOLLOW_UP_COMPLETE_RE\|FOLLOW_UP_PARTIAL_RE\|parseSSEChunk\|function stripFollowUpBlock" lib app components` returns hits only inside `lib/utils/chat-helpers.ts` (definitions) and `lib/hooks/use-chat.ts` (imports/uses).
- `npx tsc --noEmit` passes.
- Manual smoke: send a chat message in `/chat`, observe stream — content streams correctly, follow-up chips appear at the end, no flash of `<!--follow-ups:…-->` HTML in the bubble.

**Forward compatibility:** Increment 2's `streaming-actions.ts` will import the same two helpers from `chat-helpers.ts`. Part 6 will assert the regex appears in exactly one source file (`grep` returns exactly the `chat-helpers.ts` definition); this increment satisfies that condition early.

---

### Increment 2 — Streaming module

**What:** Build the entire `lib/streaming/` module: types, store, imperative actions (including the SSE loop), and React hooks. **Nothing in the app calls into this module yet** — Part 2 will wire `useChat` and Part 3 will wire chat-input. Part 1's job is to land the module compiled, type-checked, and ready.

**New files:**

| File | Purpose |
|------|---------|
| `lib/streaming/streaming-types.ts` | Type definitions: `ConversationStreamSlice`, `StartStreamArgs`, `IDLE_SLICE_DEFAULTS` constant |
| `lib/streaming/streaming-store.ts` | Module-level Map of slices, listener Set, `AbortController` map; `subscribe`/`getSlice`/`setSlice`/`deleteSlice`/`listSlices` API |
| `lib/streaming/streaming-actions.ts` | `startStream` (SSE loop), `cancelStream`, `markConversationViewed`, `clearAllStreams` |
| `lib/streaming/streaming-hooks.ts` | All seven `useSyncExternalStore`-backed hooks listed in the foundation section above |
| `lib/streaming/index.ts` | Barrel — re-exports the public surface |

**Implementation details:**

#### 2a. `streaming-types.ts`

```ts
import type { Message, ChatSource, StreamState } from "@/lib/types/chat";

export interface ConversationStreamSlice {
  conversationId: string;
  teamId: string | null;
  streamState: StreamState;
  streamingContent: string;
  statusText: string | null;
  latestSources: ChatSource[] | null;
  latestFollowUps: string[];
  error: string | null;
  assistantMessageId: string | null;
  hasUnseenCompletion: boolean;
  finalMessage: Message | null;
  startedAt: number;
}

export interface StartStreamArgs {
  conversationId: string;
  teamId: string | null;
  userMessage: string;
  userMessageId: string;
  /** Fires once when the server confirms the new conversation row via X-Conversation-Id header. Preserves the Gap P9 contract. */
  onConversationCreated?: (id: string) => void;
}

/** Used to seed a fresh slice. Not frozen — slices are mutated through setSlice's spread. */
export const IDLE_SLICE_DEFAULTS = {
  streamState: "idle" as StreamState,
  streamingContent: "",
  statusText: null,
  latestSources: null,
  latestFollowUps: [] as string[],
  error: null,
  assistantMessageId: null,
  hasUnseenCompletion: false,
  finalMessage: null,
} as const;
```

#### 2b. `streaming-store.ts`

```ts
import type { ConversationStreamSlice } from "./streaming-types";

type Listener = () => void;

const slices = new Map<string, ConversationStreamSlice>();
const listeners = new Set<Listener>();
const abortControllers = new Map<string, AbortController>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSlice(id: string): ConversationStreamSlice | undefined {
  return slices.get(id);
}

export function setSlice(
  id: string,
  partial: Partial<ConversationStreamSlice> & Pick<ConversationStreamSlice, "conversationId">
): void {
  const current = slices.get(id);
  slices.set(id, { ...current, ...partial } as ConversationStreamSlice);
  notify();
}

export function deleteSlice(id: string): void {
  slices.delete(id);
  notify();
}

/** Snapshot — used by aggregate hooks. Returns the same Map reference; hooks compute derived snapshots from it. */
export function listSlices(): ReadonlyMap<string, ConversationStreamSlice> {
  return slices;
}

export function setAbortController(id: string, controller: AbortController): void {
  abortControllers.set(id, controller);
}

export function getAbortController(id: string): AbortController | undefined {
  return abortControllers.get(id);
}

export function deleteAbortController(id: string): void {
  abortControllers.delete(id);
}

export function clearAll(): void {
  for (const ctrl of abortControllers.values()) ctrl.abort();
  abortControllers.clear();
  slices.clear();
  notify();
}

function notify() {
  for (const l of listeners) l();
}
```

**Note on `clearAll`.** Sign-out path (Increment 3) calls this. Aborts all in-flight streams, discards all slices, notifies. After return, `slices.size === 0` and `abortControllers.size === 0`.

#### 2c. `streaming-actions.ts`

The SSE loop mirrors the logic currently in `use-chat.ts:333–529` (`sendMessage`), with these differences:

- Writes to the store via `setSlice` instead of React `setState`.
- Does **not** mutate any `messages[]` array — that's `useChat`'s job (Part 2 reads `slice.finalMessage` on streaming→idle transition and folds it in).
- Reads `parseSSEChunk` and `stripFollowUpBlock` from `chat-helpers.ts` (Increment 1).

```ts
import { parseFollowUps, parseSSEChunk, stripFollowUpBlock } from "@/lib/utils/chat-helpers";
import type { ChatSource, Message } from "@/lib/types/chat";
import {
  setSlice, getSlice, setAbortController, getAbortController,
  deleteAbortController, clearAll,
} from "./streaming-store";
import type { StartStreamArgs } from "./streaming-types";
import { IDLE_SLICE_DEFAULTS } from "./streaming-types";

const LOG_PREFIX = "[streaming]";

export function startStream(args: StartStreamArgs): void {
  const { conversationId, teamId, userMessage, userMessageId, onConversationCreated } = args;

  // Seed the slice as streaming. This makes subscribers (chat-area, sidebar dots) light up immediately.
  setSlice(conversationId, {
    ...IDLE_SLICE_DEFAULTS,
    conversationId,
    teamId,
    streamState: "streaming",
    startedAt: Date.now(),
  });

  const controller = new AbortController();
  setAbortController(conversationId, controller);

  // SSE loop runs detached — caller doesn't await. Errors are written to the slice.
  void runStream({ conversationId, userMessage, userMessageId, signal: controller.signal, onConversationCreated })
    .catch((err) => {
      // Abort path is the only non-error termination; the runStream body handles it explicitly.
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`${LOG_PREFIX} stream failed: ${message}`);
      setSlice(conversationId, {
        conversationId,
        streamState: "error",
        error: message,
        streamingContent: "",
        statusText: null,
      });
    })
    .finally(() => {
      deleteAbortController(conversationId);
    });
}

interface RunStreamArgs {
  conversationId: string;
  userMessage: string;
  userMessageId: string;
  signal: AbortSignal;
  onConversationCreated?: (id: string) => void;
}

async function runStream(args: RunStreamArgs): Promise<void> {
  const { conversationId, userMessage, userMessageId, signal, onConversationCreated } = args;

  const res = await fetch("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, userMessageId, message: userMessage }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  const headerAssistantId = res.headers.get("X-Assistant-Message-Id");
  if (headerAssistantId) {
    setSlice(conversationId, { conversationId, assistantMessageId: headerAssistantId });
  }

  // Notify the caller that the conversation row exists server-side. Preserves Gap P9.
  if (onConversationCreated) onConversationCreated(conversationId);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let sseBuffer = "";
  let accumulatedContent = "";
  let accumulatedSources: ChatSource[] | null = null;
  let accumulatedFollowUps: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const { events, remaining } = parseSSEChunk(sseBuffer);
    sseBuffer = remaining;

    for (const sseEvent of events) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(sseEvent.data);
      } catch {
        console.warn(`${LOG_PREFIX} failed to parse SSE event: ${sseEvent.event}`);
        continue;
      }

      switch (sseEvent.event) {
        case "status":
          setSlice(conversationId, { conversationId, statusText: (data.text as string) ?? null });
          break;
        case "delta":
          accumulatedContent += (data.text as string) ?? "";
          setSlice(conversationId, {
            conversationId,
            streamingContent: stripFollowUpBlock(accumulatedContent),
          });
          break;
        case "sources":
          accumulatedSources = (data.sources as ChatSource[]) ?? null;
          setSlice(conversationId, { conversationId, latestSources: accumulatedSources });
          break;
        case "follow_ups":
          accumulatedFollowUps = (data.questions as string[]) ?? [];
          setSlice(conversationId, { conversationId, latestFollowUps: accumulatedFollowUps });
          break;
        case "done":
          // No-op here — final message construction happens after loop exit.
          break;
        case "error":
          throw new Error((data.message as string) ?? "Stream error");
      }
    }
  }

  // Stream completed cleanly. Build the final message and hand it to the slice in
  // the SAME setSlice call that flips streamState to 'idle' — so subscribers (Part 2:
  // useChat) see the transition and the finalMessage atomically. This is the
  // mechanism behind P2.R7's "no flicker" guarantee.
  const { cleanContent } = parseFollowUps(accumulatedContent);
  const sliceNow = getSlice(conversationId);
  const assistantId = sliceNow?.assistantMessageId ?? `temp-assistant-${Date.now()}`;

  const finalMessage: Message = {
    id: assistantId,
    conversationId,
    parentMessageId: null,
    role: "assistant",
    content: cleanContent,
    sources: accumulatedSources,
    status: "completed",
    metadata: null,
    createdAt: new Date().toISOString(),
  };

  // hasUnseenCompletion is set by Part 4's selection logic — Part 1 leaves it false.
  // Part 2 (useChat) and Part 4 (sidebar) will both read finalMessage and decide.
  setSlice(conversationId, {
    conversationId,
    streamState: "idle",
    streamingContent: "",
    statusText: null,
    finalMessage,
  });
}

export function cancelStream(conversationId: string): void {
  const controller = getAbortController(conversationId);
  if (!controller) return;
  controller.abort();
  deleteAbortController(conversationId);

  // Read current accumulated content from the slice to preserve it as the cancelled bubble (Gap E14 parity).
  const slice = getSlice(conversationId);
  const partialContent = slice?.streamingContent ?? "";
  const assistantId = slice?.assistantMessageId ?? `temp-cancelled-${Date.now()}`;

  if (partialContent) {
    const cancelledMessage: Message = {
      id: assistantId,
      conversationId,
      parentMessageId: null,
      role: "assistant",
      content: partialContent,
      sources: null,
      status: "cancelled",
      metadata: null,
      createdAt: new Date().toISOString(),
    };
    setSlice(conversationId, {
      conversationId,
      streamState: "idle",
      streamingContent: "",
      statusText: null,
      finalMessage: cancelledMessage,
    });
  } else {
    setSlice(conversationId, {
      conversationId,
      streamState: "idle",
      streamingContent: "",
      statusText: null,
    });
  }
}

export function markConversationViewed(conversationId: string): void {
  // Part 4 uses this. Part 1 implements it; no caller yet.
  const slice = getSlice(conversationId);
  if (!slice || !slice.hasUnseenCompletion) return;
  setSlice(conversationId, { conversationId, hasUnseenCompletion: false });
}

export function clearAllStreams(): void {
  clearAll();
}
```

#### 2d. `streaming-hooks.ts`

```ts
import { useSyncExternalStore } from "react";
import { subscribe, getSlice, listSlices } from "./streaming-store";
import type { ConversationStreamSlice } from "./streaming-types";

// ---------- single-conversation hooks ----------

export function useStreamingSlice(id: string | null): ConversationStreamSlice | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? getSlice(id) ?? null : null),
    () => null // SSR snapshot
  );
}

export function useIsStreaming(id: string | null): boolean {
  const slice = useStreamingSlice(id);
  return slice?.streamState === "streaming";
}

// ---------- aggregate hooks (workspace-filtered) ----------
// NOTE: aggregate getSnapshot returns a NEW array each call, which would defeat
// useSyncExternalStore's bailout. We cache the last result by deep-equality on
// content to keep the reference stable when nothing relevant changed. This is
// the standard pattern for "selector returns derived data" with the built-in
// useSyncExternalStore. Future migration to useSyncExternalStoreWithSelector
// (from `use-sync-external-store/with-selector`) is an option if perf demands.

let activeStreamIdsCache = new Map<string | null, { teamId: string | null; result: string[] }>();

function computeActiveStreamIds(teamId: string | null): string[] {
  const out: string[] = [];
  for (const slice of listSlices().values()) {
    if (slice.teamId === teamId && slice.streamState === "streaming") out.push(slice.conversationId);
  }
  return out;
}

function stableActiveStreamIds(teamId: string | null): string[] {
  const cached = activeStreamIdsCache.get(teamId);
  const fresh = computeActiveStreamIds(teamId);
  if (cached && cached.result.length === fresh.length && cached.result.every((id, i) => id === fresh[i])) {
    return cached.result;
  }
  activeStreamIdsCache.set(teamId, { teamId, result: fresh });
  return fresh;
}

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

let unseenCompletionIdsCache = new Map<string | null, string[]>();

function computeUnseenCompletionIds(teamId: string | null): string[] {
  const out: string[] = [];
  for (const slice of listSlices().values()) {
    if (slice.teamId === teamId && slice.hasUnseenCompletion) out.push(slice.conversationId);
  }
  return out;
}

function stableUnseenCompletionIds(teamId: string | null): string[] {
  const cached = unseenCompletionIdsCache.get(teamId);
  const fresh = computeUnseenCompletionIds(teamId);
  if (cached && cached.length === fresh.length && cached.every((id, i) => id === fresh[i])) {
    return cached;
  }
  unseenCompletionIdsCache.set(teamId, fresh);
  return fresh;
}

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
```

#### 2e. `index.ts`

```ts
export type { ConversationStreamSlice, StartStreamArgs } from "./streaming-types";
export {
  startStream,
  cancelStream,
  markConversationViewed,
  clearAllStreams,
} from "./streaming-actions";
export {
  useStreamingSlice,
  useIsStreaming,
  useActiveStreamIds,
  useActiveStreamCount,
  useUnseenCompletionIds,
  useHasAnyUnseenCompletion,
} from "./streaming-hooks";
```

**Verify:**

- `npx tsc --noEmit` passes — the module compiles in isolation.
- `grep -rn "from \"@/lib/streaming\"" lib app components` returns zero hits in Part 1 (nothing wires it yet).
- `npm run build` passes — verifies the module is importable in a Next.js client bundle (the `'use client'` directive may need to be added to `streaming-hooks.ts`; confirm during implementation).
- The legacy chat flow on `/chat` works identically to pre-PRD behavior (manual smoke test — send, abort, retry, conversation switch, fresh chat — all behave as before).

**Forward compatibility:**

- Part 2 wires `useChat` to consume `useStreamingSlice` for streaming fields and to call `startStream` / `cancelStream` from its `sendMessage` / `cancelStream` exports. The `finalMessage` field on the slice is the handoff: `useChat` watches for `streamState` transitioning to `idle` while `finalMessage !== null`, appends it to `messages[]`, and immediately calls `setSlice(id, { finalMessage: null })` to clear it (so the same final message isn't re-appended on re-subscribe). This is what enables P2.R7's no-flicker guarantee.
- Part 3 will use `useActiveStreamCount(teamId)` to gate the chat-input at the cap (5) and use the existing `useIsStreaming(activeId)` for the per-conversation Send/Stop button.
- Part 4 will use `useActiveStreamIds(teamId)` and `useUnseenCompletionIds(teamId)` for sidebar dots, and `useActiveStreamCount(teamId)` for the footer text. The "set hasUnseenCompletion=true on completion when no chat-area subscribed to A" decision lands in Part 4 — the field is already on the slice; Part 4 wires the policy.
- Part 5 will read `useActiveStreamIds(activeTeamId)` and `useHasAnyUnseenCompletion(activeTeamId)` for the AppSidebar chat icon dot, and the existing `teamId`-keyed slice filter delivers workspace isolation (P5.R5) for free.
- Part 6 will reduce `lib/hooks/use-chat.ts` to a thin message-list hook by deleting the legacy SSE loop, abort controller, and streaming state. The SSE utility extraction is already done in Increment 1 of this part, so Part 6's "one source of truth for SSE/follow-up parsing" goal is reached as soon as Part 2 lands.

---

### Increment 3 — Sign-out teardown

**What:** Wire `clearAllStreams()` into the existing `signOut` flow in `auth-provider.tsx`, alongside `clearActiveTeamCookie()`. Add a dev-only smoke verification that the legacy chat flow still works end-to-end after the streaming module is in the bundle.

**Files changed:**

| File | Action |
|------|--------|
| `components/providers/auth-provider.tsx` | **Modify** — `signOut` (around line 105–112): add `clearAllStreams()` call alongside `clearActiveTeamCookie()`; import from `@/lib/streaming` |

**Implementation details:**

The current `signOut` (per the survey: `auth-provider.tsx:105–112`) calls `supabase.auth.signOut()` then `clearActiveTeamCookie()` then clears local user/team state and redirects to `/login`. Add one line:

```ts
import { clearAllStreams } from "@/lib/streaming";

// ... inside signOut, after clearActiveTeamCookie() and before redirect:
clearAllStreams();
```

`clearAllStreams()` aborts every in-flight `AbortController`, discards every slice, and notifies subscribers — so any subscriber still mounted (e.g., a stale chat-area during the redirect transition) sees idle slices and renders nothing. By the time the user lands on `/login`, the store is empty.

**Verify:**

- `grep -rn "clearAllStreams\|@/lib/streaming" components/providers` returns hits only in `auth-provider.tsx`.
- `npx tsc --noEmit` passes.
- Manual smoke test (P1.R5 — full legacy behavior preserved):
  - Send a message in `/chat` → streams correctly, completes correctly.
  - Switch conversations mid-stream → existing pre-PRD bleed bug is *still present* (correct — this PR doesn't fix it; Part 2 does).
  - Abort a stream → cancelled bubble appears as before.
  - Retry a failed message → re-sends correctly.
  - Sign out, sign back in → no residual streaming UI, fresh chat works.
  - Sign out *during a stream* → stream aborts, no orphan UI on the login page; signing back in shows the persisted message in the conversation list (server-side completion) when revisiting the conversation.

**Forward compatibility:** Part 5's P5.R4 ("streams do not leak across users") is fully satisfied by this single line — `clearAllStreams` runs before the user state flips, so no slice survives the user transition.

---

### Part 1 end-of-part audit

Per CLAUDE.md, the last increment of every part triggers an end-of-part audit pass. For Part 1, that includes:

1. **SRP** — Each file in `lib/streaming/` has one job: types, store, actions, hooks. No file mixes concerns.
2. **DRY** — `parseSSEChunk` and `stripFollowUpBlock` exist in exactly one source file (`chat-helpers.ts`). The legacy `useChat` and the new module both import them.
3. **Design tokens** — Not applicable (no UI in Part 1).
4. **Logging** — `streaming-actions.ts` uses `LOG_PREFIX = "[streaming]"` for entry/exit/error logs in `startStream`. Errors are logged before being written to the slice.
5. **Dead code** — `use-chat.ts` no longer contains the moved helpers; old constants/regex are deleted, not commented.
6. **Convention compliance** — Files use kebab-case; functions are named exports; types are interfaces; imports follow the project order (React → third-party → internal).

This audit produces fixes in the same PR, not a separate report.

### After Part 1 completes

Per CLAUDE.md ("After each TRD part completes"):

1. **`ARCHITECTURE.md` update** — Add `lib/streaming/*` to the file map. Defer the full streaming-context section to Part 7 (which is the dedicated documentation part); a one-paragraph stub note in Part 1's audit pass is acceptable.
2. **`CHANGELOG.md` entry** — `PRD-024 P1: streaming-context module foundation (no consumers wired)`.
3. **No DB schema change** — no Supabase types regen needed.
4. **Test affected flows** — covered by Increment 3's manual smoke test.

---

# Part 2
## Part 2 — `useChat` Migration

This part covers P2.R1 through P2.R7 from the PRD. The legacy in-hook streaming path is removed; `useChat` becomes a thin orchestrator that delegates SSE to the streaming module (Part 1) and retains only its message-list role. **The pre-existing UI-bleed bug is fixed as a structural side-effect** (P2.R4) — the chat-area's streaming view now reads from a slice keyed by the active conversation ID, so switching conversations switches which slice is read, with zero leakage.

**Database models:** None.
**API endpoints:** None — the `/api/chat/send` route is unchanged. The streaming module already consumes it via Part 1's `runStream`.
**Frontend pages/components:** `lib/hooks/use-chat.ts` is rewritten end-to-end. No chat-surface component (`chat-area.tsx`, `chat-input.tsx`, `message-thread.tsx`, `streaming-message.tsx`, `chat-page-content.tsx`) changes — P2.R5 mandates the passthrough surface is preserved.
**New module addition:** `markFinalMessageConsumed(id)` is added to `lib/streaming/streaming-actions.ts` (and re-exported via `index.ts`). This is the one Part-1-public-API extension Part 2 requires; symmetric with the existing `markConversationViewed` (both are atomic per-field clears triggered by consumer-side acknowledgment).

### Architectural pivot

Part 2's central design choice — the mechanism that makes P2.R7's "no flicker on stream completion" guarantee work — is **`useLayoutEffect` for the final-message handoff**.

The slice's `finalMessage` field is set in the *same* `setSlice` call that flips `streamState` to `idle` (Part 1, `streaming-actions.ts:443–449`). When `useChat` is mounted on the active conversation:

1. The slice update triggers a re-render of `useChat` (via `useStreamingSlice`).
2. **Render N:** chat-area sees `streamState === 'idle'` (streaming bubble vanishes) and `messages` still without the new message. React commits the DOM but **does not yet paint** — `useLayoutEffect` runs first.
3. `useLayoutEffect` fires synchronously, observes `slice.finalMessage` is non-null, calls `setMessages(prev => [...prev, slice.finalMessage])`, and calls `markFinalMessageConsumed(id)` to clear the slice's `finalMessage`.
4. **Render N+1:** chat-area sees `messages` with the appended message and `slice.finalMessage === null`. React commits.
5. **Browser paints render N+1.** The user never sees render N's intermediate "no bubble, no message" state.

This is the canonical React pattern for "synchronous DOM-tied state derivations that must beat paint." `useEffect` would not work — it runs *after* paint, producing a one-frame gap (the flicker P2.R7 forbids). `useLayoutEffect` is the textbook tool here.

**Why not derive a `displayedMessages` value during render instead?** That would mean the chat-area renders `[...messages, finalMessageIfNotInList]` and `useChat` stays "pure." But this couples chat-area to slice internals (it would need to know about `finalMessage`), violating P2.R5 (passthrough surface unchanged) and SRP (rendering vs. list ownership). The `useLayoutEffect` fold preserves the existing contract: `messages: Message[]` is the single source of truth chat-area renders.

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Add `markFinalMessageConsumed` to streaming module | 1 file modified, 1 export added | tiny |
| 2 | Migrate `useChat` to the streaming module | `lib/hooks/use-chat.ts` rewritten; surface preserved | medium-large |
| 3 | End-of-part audit + manual smoke test | docs + verification fixes | small |

Each increment is independently shippable. Increment 1 lands a public-API extension that Increment 2 depends on; the streaming module ships in a usable shape after each. Increment 2 is the largest single change of the PRD — it removes ~300 LOC from `use-chat.ts` and replaces it with ~100 LOC of delegation glue.

---

### Increment 1 — `markFinalMessageConsumed` action (P2 prerequisite)

**What:** Add a single public action to the streaming module: `markFinalMessageConsumed(conversationId)`. It atomically clears `slice.finalMessage` to `null`, idempotently (no-op if already null). This is the consumer-side acknowledgment hook that Increment 2's `useLayoutEffect` will call after folding the message into `messages[]`.

**Why a dedicated action and not a re-export of `setSlice`?** `setSlice` is internal to `streaming-store.ts` — exposing it would let any consumer write any field, breaking SRP. A named action documents the intent ("the consumer has taken ownership of this message") and matches the existing pattern of `markConversationViewed` (Part 4 R6 will clear `hasUnseenCompletion` the same way).

**Files changed:**

| File | Action |
|------|--------|
| `lib/streaming/streaming-actions.ts` | **Modify** — add `markFinalMessageConsumed` function alongside `markConversationViewed`; same shape, same logging pattern |
| `lib/streaming/index.ts` | **Modify** — add `markFinalMessageConsumed` to the barrel exports |

**Implementation details:**

In `streaming-actions.ts`, append after `markConversationViewed` (mirrors its structure):

```ts
// ---------------------------------------------------------------------------
// markFinalMessageConsumed — clear finalMessage after the consumer (useChat)
// has folded it into messages[] (Part 2 R3 / P2.R7)
// ---------------------------------------------------------------------------

export function markFinalMessageConsumed(conversationId: string): void {
  const slice = getSlice(conversationId);
  if (!slice || slice.finalMessage === null) {
    return;
  }
  setSlice(conversationId, { finalMessage: null });
  console.log(
    `${LOG_PREFIX} markFinalMessageConsumed conversation=${conversationId}`
  );
}
```

In `index.ts`, add the export to the existing `streaming-actions` re-export block:

```ts
export {
  startStream,
  cancelStream,
  markConversationViewed,
  markFinalMessageConsumed, // <-- new
  clearAllStreams,
} from "./streaming-actions";
```

**Verify:**

- `npx tsc --noEmit` passes.
- `grep -rn "markFinalMessageConsumed" lib app components` returns hits only in the two modified files (no consumer wires it yet — Increment 2 will).

**Forward compatibility:** `markFinalMessageConsumed` is the symmetric counterpart of `markConversationViewed`. Both clear specific slice fields under consumer-side acknowledgment. Part 4 will use `markConversationViewed`; Part 2 (Increment 2) uses `markFinalMessageConsumed`. The pair establishes a small, predictable convention for any future "consumer cleared X" actions.

---

### Increment 2 — `useChat` migration (the bulk)

**What:** Rewrite `lib/hooks/use-chat.ts` to delegate streaming to the module from Part 1. After this increment:

- `useChat` no longer owns any streaming state (no `useState` for `streamState`/`streamingContent`/`statusText`/`latestSources`/`latestFollowUps`/`error`).
- `useChat` no longer owns the SSE loop, the `AbortController`, the `assistantMessageIdRef`, or the SSE event-parsing logic.
- `useChat` reads streaming fields from the slice via `useStreamingSlice(conversationId)`.
- `useChat`'s `sendMessage` / `cancelStream` / `retryLastMessage` delegate to `startStream` / `cancelStream` (the module's, not the hook's).
- `useChat` keeps full ownership of the message list: load on conversation change, paginate, append on stream completion (via `useLayoutEffect`), clear, not-found handling.
- The `UseChatReturn` interface is byte-for-byte identical — chat-surface components compile and run with no changes (P2.R5).
- The pre-existing UI-bleed bug is gone (P2.R4) — switching conversations switches the slice subscription, full stop.
- Stream completion swap is flicker-free (P2.R7) — `useLayoutEffect` folds and clears before paint.

**Files changed:**

| File | Action |
|------|--------|
| `lib/hooks/use-chat.ts` | **Rewrite** — remove all streaming internals; replace with slice subscription + delegation; add `useLayoutEffect` fold; preserve passthrough surface |

**Implementation details:**

1. **Remove the streaming internals.** Delete:
   - The six streaming `useState` declarations (`streamState`, `streamingContent`, `statusText`, `latestSources`, `latestFollowUps`, `error`).
   - The four streaming refs (`abortControllerRef`, `streamingContentRef`, `assistantMessageIdRef`, `messagesRef`'s use for streaming purposes — keep `messagesRef` for the load-messages effect's "skip refetch on null→just-created" guard).
   - The entire SSE loop body inside `sendMessage` (lines ~376–510 in the post-Increment-1-of-Part-1 file).
   - The cancellation body in `cancelStream` (the abort + stash-cancelled-bubble logic) — delegated to the module.
   - The `parseSSEChunk` / `stripFollowUpBlock` / `parseFollowUps` imports are no longer needed in the hook (they live in the module's `runStream`). Drop them.

2. **Add the streaming module imports.** At the top:

   ```ts
   import {
     useStreamingSlice,
     startStream as moduleStartStream,
     cancelStream as moduleCancelStream,
     markFinalMessageConsumed,
   } from "@/lib/streaming";
   ```

   The `as` aliases make the delegation visible at the call site (you see `moduleStartStream`, not just `startStream`, so it's obvious the local function is a thin wrapper).

3. **Subscribe to the slice.** Right under the existing `useState` declarations for the message list:

   ```ts
   const slice = useStreamingSlice(conversationId);
   ```

   `slice` is `ConversationStreamSlice | null`. When the conversation has no active or recently-completed slice, `slice === null`.

4. **Derive the streaming passthrough fields from the slice.** Replace the deleted `useState` reads with derived values (no `useMemo` needed — these are O(1) reads):

   ```ts
   const streamState: StreamState = slice?.streamState ?? "idle";
   const streamingContent = slice?.streamingContent ?? "";
   const statusText = slice?.statusText ?? null;
   const latestSources = slice?.latestSources ?? null;
   const latestFollowUps = slice?.latestFollowUps ?? [];
   const error = slice?.error ?? null;
   ```

   These six fields appear in `UseChatReturn` unchanged. Chat-area, message-thread, chat-input read them via the existing passthrough.

5. **Rewrite `sendMessage`.** It becomes a small wrapper preserving Gap P9 semantics:

   ```ts
   const sendMessage = useCallback(
     async (content: string) => {
       console.log(`${LOG_PREFIX} sendMessage — content length: ${content.length}`);

       const userMessageId = crypto.randomUUID();
       const isFreshSend = conversationIdRef.current === null;
       const conversationIdForPost = conversationIdRef.current ?? crypto.randomUUID();

       // Optimistic user message — same as legacy.
       const optimisticUserMessage: Message = {
         id: userMessageId,
         conversationId: conversationIdForPost,
         parentMessageId: null,
         role: "user",
         content,
         sources: null,
         status: "completed",
         metadata: null,
         createdAt: new Date().toISOString(),
       };
       setMessages((prev) => [...prev, optimisticUserMessage]);

       // Delegate the SSE work to the streaming module.
       moduleStartStream({
         conversationId: conversationIdForPost,
         teamId,
         userMessage: content,
         userMessageId,
         onConversationCreated: isFreshSend
           ? onConversationCreatedRef.current
           : undefined,
       });
     },
     [teamId]
   );
   ```

   Notes:
   - The Gap P9 contract is preserved: `useChat.sendMessage` still owns the UUID generation for fresh sends, the optimistic user-message append, and the `onConversationCreated` callback wiring. The streaming module is the new SSE owner; everything around it stays in `useChat`.
   - `teamId` becomes a new option on `UseChatOptions` (passed by `chat-page-content.tsx` from `useAuth().activeTeamId`). The hook no longer pulls it from context internally — preserves the dependency-inversion conventions in CLAUDE.md and keeps `useChat` framework-agnostic about auth.
   - `sendMessage` no longer awaits anything — it returns immediately after kicking off the stream. The `Promise<void>` return type is preserved for compatibility with chat-input's existing `async`/`await` call site, but the hook no longer needs to track per-call lifecycle.

6. **Rewrite `cancelStream`.** Trivially delegates:

   ```ts
   const cancelStream = useCallback(() => {
     console.log(`${LOG_PREFIX} cancelStream`);
     if (conversationIdRef.current) {
       moduleCancelStream(conversationIdRef.current);
     }
     // Cancelled-bubble construction lives in the module now (Part 1 streaming-actions.ts);
     // it sets slice.finalMessage to a status:"cancelled" Message.
     // The useLayoutEffect below folds it into messages[] like any other completion.
   }, []);
   ```

7. **Add the `useLayoutEffect` fold (P2.R7).** Place it after the message-list effects, before the return:

   ```ts
   // P2.R7: synchronously fold the slice's finalMessage into messages[] before
   // the browser paints the streamState→idle transition. This is the canonical
   // pattern for "DOM-tied derivations that must beat paint."
   useLayoutEffect(() => {
     if (!slice?.finalMessage) return;
     const completed = slice.finalMessage;
     setMessages((prev) => [...prev, completed]);
     // Acknowledge consumption so the message isn't re-folded on re-subscribe
     // (e.g., when the user navigates away and back to this conversation).
     if (slice.conversationId) {
       markFinalMessageConsumed(slice.conversationId);
     }
   }, [slice?.finalMessage, slice?.conversationId]);
   ```

   Why both `slice?.finalMessage` and `slice?.conversationId` in the deps:
   - `slice?.finalMessage` is the primary trigger — when it transitions from null to a Message, fold.
   - `slice?.conversationId` guards against the cross-conversation navigation case: if `useChat` re-keys to a different conversation whose slice happens to also have a `finalMessage`, the effect re-fires for the new id rather than skipping (which would happen if the dep array compared only by `finalMessage`'s reference and the new conversation's `finalMessage` was the same object — vanishingly unlikely but defensively correct).

8. **Rewrite `retryLastMessage`.** The trim logic is unchanged; only the re-send delegates to the new `sendMessage`:

   ```ts
   const retryLastMessage = useCallback(async () => {
     console.log(`${LOG_PREFIX} retryLastMessage`);

     const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
     if (!lastUserMessage) {
       console.warn(`${LOG_PREFIX} no user message found to retry`);
       return;
     }

     setMessages((prev) => {
       let trimmed = prev;
       const last = trimmed[trimmed.length - 1];
       if (
         last &&
         last.role === "assistant" &&
         (last.status === "failed" ||
           last.status === "cancelled" ||
           last.status === "streaming")
       ) {
         trimmed = trimmed.slice(0, -1);
       }
       const newLast = trimmed[trimmed.length - 1];
       if (
         newLast &&
         newLast.role === "user" &&
         newLast.content === lastUserMessage.content
       ) {
         trimmed = trimmed.slice(0, -1);
       }
       return trimmed;
     });

     await sendMessage(lastUserMessage.content);
   }, [messages, sendMessage]);
   ```

   No streaming-internal cleanup is needed before retry — `moduleStartStream` re-seeds the slice from `IDLE_SLICE_DEFAULTS` (Part 1, `streaming-actions.ts:39–45`), which clears any stale `finalMessage`/`error`/etc. from the previous attempt.

9. **`UseChatOptions` gains `teamId`.** The hook needs it to pass through to `startStream` for workspace-scoped slice keying (Part 5 forward-compat). Update the interface:

   ```ts
   interface UseChatOptions {
     conversationId: string | null;
     teamId: string | null;
     onConversationCreated?: (id: string) => void;
     onTitleGenerated?: (id: string, title: string) => void;
   }
   ```

   And update the one caller in `app/chat/_components/chat-page-content.tsx`:

   ```ts
   const chatHook = useChat({
     conversationId: activeConversationId,
     teamId, // <-- new; already in scope from useAuth()
     onConversationCreated: handleConversationCreated,
     onTitleGenerated: handleTitleGenerated,
   });
   ```

   This is the only chat-surface change in Part 2 — strictly additive (a new prop), no behavioral change to existing fields. P2.R5's "passthrough surface unchanged" applies to the *return* surface; adding a required option on the input side is acceptable scope for a hook migration.

10. **Preserve the load-messages effect verbatim.** The existing logic — including the Gap P9 `prev === null && messagesRef.current.length > 0` guard that skips the refetch on the fresh-send → conversation-confirmed transition — stays exactly as-is. The optimistic user message is still added by `sendMessage` *before* `moduleStartStream` fires, so by the time `onConversationCreated` triggers the parent's `setActiveConversationId(uuid)` and `useChat` re-renders with the new id, `messagesRef.current.length > 0` is true — guard fires correctly.

11. **`UseChatReturn` is byte-identical.** Same fields, same names, same types. P2.R5 enforced by reading the existing interface and not touching it.

**Verify:**

- `npx tsc --noEmit` passes.
- `grep -rn "abortControllerRef\|assistantMessageIdRef\|streamingContentRef\|parseSSEChunk\|stripFollowUpBlock" lib/hooks/use-chat.ts` returns no hits (all streaming internals removed).
- `wc -l lib/hooks/use-chat.ts` reports under 250 LOC (down from 597 post-P1-Increment-1).
- Manual smoke test on `/chat` (the full P2 acceptance battery):
  - **P2.R4 bleed-bug verification:** start a stream in conversation A, switch to B mid-stream — no streaming bubble appears in B, no final message lands in B. Switch back to A — the message is there (live or completed depending on timing).
  - **P2.R6 cancellation:** abort mid-stream — cancelled bubble appears with partial content, status `cancelled`.
  - **P2.R6 retry:** click retry on a failed/cancelled assistant message — re-sends correctly, fresh stream begins.
  - **P2.R6 fresh send:** start a new chat — UUID generates, URL silently updates to `/chat/<id>` after first response, sidebar prepends.
  - **P2.R7 no-flicker:** complete a stream while viewing the active conversation — the streaming bubble vanishes and the final message appears in the same paint frame (visually: no gap).
  - **Conversation switching during streaming:** in conversation A, send → switch to B → send → both streams run in parallel (this is technically a Part 3 capability — multi-stream concurrency — but Part 2 already enables it as a side-effect of the per-conversation slice keying; Part 3 only adds the cap and the per-input gating). Both messages persist server-side to their correct conversations.

**Forward compatibility:**

- **Part 3** changes `chat-input.tsx`'s Send-button gating from "any stream active" to "this conversation streaming." The chat-input already reads `streamState` from `useChat`'s passthrough; after Part 2, that's per-conversation (it's the slice for `activeConversationId`). Part 3's change is a one-line condition tweak — no Part 2 work to redo.
- **Part 3** also adds the concurrency cap. `useActiveStreamCount(teamId)` already exists from Part 1; Part 3 wires it into `chat-input.tsx` for the cap-blocked inline message. No `useChat` change needed.
- **Part 4** adds `hasUnseenCompletion` flipping. The decision policy ("set true on completion only if no chat-area is currently subscribed to this conversation") lands in Part 4. The mechanism is straightforward: `useChat`'s `useLayoutEffect` fold runs *only when the user is viewing the conversation*, so it can preempt the unseen flag. Two concrete paths Part 4 can choose between:
  - (a) The streaming module sets `hasUnseenCompletion: true` on every stream completion; `useChat`'s fold immediately calls `markConversationViewed` alongside `markFinalMessageConsumed`. If no `useChat` is mounted on this id, the flag persists — the desired sidebar state. *Simple, self-correcting.*
  - (b) `useChat` registers a "currently viewing" hint in the store via a new action; the streaming module reads this at completion time. More complex; rejected for Part 4 unless (a) proves insufficient.
- **Part 6** finishes the cleanup pass. After Increment 2 here, `use-chat.ts` is already under the 200-LOC ceiling P6.R4 mandates and contains no streaming internals (P6.R1, P6.R3). Part 6 will only need to verify and update docs — most of its acceptance criteria are met as a side-effect of this increment.

---

### Increment 3 — End-of-part audit + verification

**What:** The audit pass per CLAUDE.md "End-of-part audit" + the post-merge documentation updates.

**Files changed:** Audit may produce code fixes in `lib/hooks/use-chat.ts` and/or the streaming module. Documentation:

| File | Action |
|------|--------|
| `ARCHITECTURE.md` | **Modify** — update the `lib/hooks/use-chat.ts` description to reflect its new role (message-list orchestrator, no streaming internals); note the `useStreamingSlice` consumption |
| `CHANGELOG.md` | **Add entry** — `PRD-024 P2: useChat migration to streaming module + bleed-bug fix + no-flicker handoff` |

**Audit checklist (per CLAUDE.md, applied to Increment 2's changes):**

1. **SRP** — `useChat` does one thing (manage the active conversation's message list). Streaming, SSE parsing, abort handling all live in `lib/streaming/`. The `useLayoutEffect` fold is not "streaming logic" — it's a list-mutation handoff, which belongs to the message-list owner.
2. **DRY** — There are now no remaining duplicates of SSE parsing (Part 1 Increment 1 already collapsed those), abort handling (in the module), or stream-state machinery (in the module). The follow-up regex still lives in exactly one source file (`chat-helpers.ts`); the SSE chunk decoder still lives in exactly one source file. P6.R2's "exactly one source" check passes after this increment.
3. **Design tokens** — N/A (no UI changes).
4. **Logging** — `useChat`'s `sendMessage`, `cancelStream`, `retryLastMessage` all retain entry logs with `[useChat]` prefix. The streaming module owns the SSE-loop logs with `[streaming]` prefix. Errors from the module surface to `slice.error`, which `useChat` passes through; if `slice.error` becomes set, the chat-area's existing error-banner renders it.
5. **Dead code** — Verify `parseSSEChunk`, `stripFollowUpBlock`, `parseFollowUps`, `abortControllerRef`, `streamingContentRef`, `assistantMessageIdRef`, and the SSE loop body are all gone from `use-chat.ts`. No commented-out residue.
6. **Convention compliance** — Imports follow project order (React → utilities → internal modules → types). Exports are named. `'use client'` directive retained at the top.

**Manual verification — the P2 acceptance battery (also lives in Increment 2's verify section; reproduced here as the audit gate):**

- [ ] P2.R1 — `lib/hooks/use-chat.ts` has no internal streaming state.
- [ ] P2.R2 — `useChat` does not contain the SSE loop, the `AbortController`, or the streaming state machine.
- [ ] P2.R3 — Message-list functions (load, paginate, append-via-fold, clear, not-found) all in `useChat`.
- [ ] P2.R4 — Manual reproduction of the legacy bleed bug: send in A, switch to B mid-stream → no bubble or message in B.
- [ ] P2.R5 — Chat-surface components compile and run unchanged. `git diff` shows zero modifications outside `lib/hooks/use-chat.ts`, `lib/streaming/streaming-actions.ts`, `lib/streaming/index.ts`, and `app/chat/_components/chat-page-content.tsx` (the one-prop addition).
- [ ] P2.R6 — Send + abort + retry + cross-conversation switch all behave coherently across smoke tests.
- [ ] P2.R7 — Stream completion produces no visible flicker (visual check in DevTools' "Paint Flashing" overlay confirms no separate paint frames between bubble-vanish and message-appear).

This audit produces fixes in the same PR, not a separate report.

### After Part 2 completes

Per CLAUDE.md ("After each TRD part completes"):

1. **`ARCHITECTURE.md` update** — Update `lib/hooks/use-chat.ts`'s file-map description to: *"Chat orchestrator — owns conversation-scoped message list (load, paginate, fold-on-completion, clear, not-found); delegates SSE/abort/state to `lib/streaming` (PRD-024 Part 2)"*. The streaming-module description from Part 1 already covers the SSE side.
2. **`CHANGELOG.md` entry** — Document the migration, the bleed-bug fix as a structural side-effect, and the no-flicker mechanism. Include the `markFinalMessageConsumed` API addition.
3. **No DB schema change** — no Supabase types regen.
4. **Test affected flows** — covered by Increment 2's manual smoke test + Increment 3's audit gate.

---

# Part 3
## Part 3 — Multi-Conversation Streaming

This part covers P3.R1 through P3.R5 from the PRD. **Most of the heavy lifting is already done.** Per-conversation slices (Part 1) and per-conversation `useChat` subscriptions (Part 2) made multi-stream concurrency a *structural property* of the architecture: every conversation has its own slice, its own SSE loop, its own `AbortController`, and its own state machine. A user can already start streams in conversation A and B in parallel after Part 2 ships — there's nothing in the runtime preventing it. The Send-button gating in `chat-input.tsx` reads `streamState` from `useChat`'s passthrough, which is now per-conversation, so the button correctly disables only on the conversation whose stream is active.

What's missing is the **safety rail**: the soft cap of 5 concurrent streams (P3.R3) and the user-facing affordance for the cap-blocked state. That's the entire scope of Part 3.

**Database models:** None.
**API endpoints:** None — the per-stream nature of `/api/chat/send` was already correct.
**Frontend pages/components:** `app/chat/_components/chat-input.tsx` (cap gating + inline blocking message), `app/chat/_components/chat-area.tsx` (one new prop pass-through). The per-conversation gating that P3.R1 calls for is already in place from Part 2 — no edits needed for that requirement.
**New module addition:** `MAX_CONCURRENT_STREAMS` constant in `lib/streaming/streaming-types.ts`, re-exported via the barrel. A defensive cap guard is added at the top of `startStream` so a runtime caller can't bypass the UI gate and exceed the cap (defense in depth).

### Architectural pivot

The pivot is to **resist over-engineering**. P3 looks like a feature ("multi-stream") but it's mostly UX wiring — the actual concurrency primitive is already there. The temptation is to build cap-management infrastructure, queue managers, slot reservations, etc. That's all overkill. The right design:

- One constant: `MAX_CONCURRENT_STREAMS = 5`. Single source-controlled value (P3.R3).
- One defensive check inside `startStream`: refuse if at cap, log a warning, return. Catches bugs where a future caller bypasses the UI.
- One UI gate in `chat-input.tsx`: read `useActiveStreamCount(teamId)` (Part 1 hook), compare to the cap, render the inline blocking message when exceeded.

That's the entire implementation. ~30 LOC of new logic across three files. The P3.R1 per-conversation gating, P3.R2 parallel runs, P3.R4 decoupled completion, and P3.R5 per-stream cancellation are all preserved-by-default from Parts 1 & 2 — Part 3 only verifies them via manual testing.

### Where the cap message lives

The PRD locks the wording: *"Already running 5 chats — wait until one of them completes before starting another."* Two implementation choices:

- **Hardcoded literal.** Smallest diff. Drift risk if `MAX_CONCURRENT_STREAMS` changes — message might say "5" when the cap is "7".
- **Templated from the constant.** ``Already running ${MAX_CONCURRENT_STREAMS} chats — wait...`` Ten more characters; eliminates drift; pins the wording-cap relationship in code.

Templated wins on quality grounds. Single source of truth.

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Add `MAX_CONCURRENT_STREAMS` + defensive cap guard in `startStream` | `streaming-types.ts`, `streaming-actions.ts`, `index.ts` | tiny |
| 2 | Wire cap into `chat-input.tsx` | `chat-input.tsx` (cap gate + inline message), `chat-area.tsx` (one prop pass-through) | small |
| 3 | End-of-part audit + manual verification | docs + audit fixes | small |

Each increment is independently shippable. Increment 1 lands the constant + defense-in-depth without any UI change. Increment 2 wires the user-facing affordance.

---

### Increment 1 — Cap constant + defensive guard

**What:** Add `MAX_CONCURRENT_STREAMS = 5` to `streaming-types.ts`, re-export it through the module's barrel, and add a defensive check at the top of `startStream` that refuses to start a new stream when the per-workspace count is already at the cap. The defense is paired with a `console.warn` so any UI bypass surfaces in logs immediately.

**Files changed:**

| File | Action |
|------|--------|
| `lib/streaming/streaming-types.ts` | **Modify** — add `export const MAX_CONCURRENT_STREAMS = 5;` with a JSDoc anchoring the PRD reference |
| `lib/streaming/streaming-actions.ts` | **Modify** — `startStream` body gains a per-workspace count check that bails (with `console.warn`) when at the cap; uses `listSlices()` to count |
| `lib/streaming/index.ts` | **Modify** — add `MAX_CONCURRENT_STREAMS` to the re-exports |

**Implementation details:**

1. **Constant in `streaming-types.ts`** (place after `IDLE_SLICE_DEFAULTS`):

   ```ts
   /**
    * Maximum concurrent streams per user per workspace, enforced client-side.
    * Pinned by PRD-024 P3.R3. The UI gate in chat-input is the primary
    * enforcement; startStream's defensive guard is the safety net.
    */
   export const MAX_CONCURRENT_STREAMS = 5;
   ```

2. **Defensive guard in `startStream`** (insert at the very top of the function body, before the slice seeding):

   ```ts
   // Defensive cap. Primary enforcement is the UI gate in chat-input
   // (Part 3 Increment 2); this guard catches any caller that bypasses
   // the gate (future bug, programmatic invocation, etc.) so we never
   // silently exceed the documented cap.
   const activeForTeam = countActiveStreams(teamId);
   if (activeForTeam >= MAX_CONCURRENT_STREAMS) {
     console.warn(
       `${LOG_PREFIX} startStream refused (cap reached) conversation=${conversationId} count=${activeForTeam}/${MAX_CONCURRENT_STREAMS}`
     );
     return;
   }
   ```

   And add the helper `countActiveStreams` near the top of `streaming-actions.ts` (just below the imports):

   ```ts
   function countActiveStreams(teamId: string | null): number {
     let count = 0;
     for (const slice of listSlices().values()) {
       if (slice.teamId === teamId && slice.streamState === "streaming") {
         count++;
       }
     }
     return count;
   }
   ```

   Imports needed: add `listSlices` to the existing `./streaming-store` import block; add `MAX_CONCURRENT_STREAMS` to the `./streaming-types` import block.

3. **Barrel export in `index.ts`**:

   ```ts
   export {
     IDLE_SLICE_DEFAULTS,
     MAX_CONCURRENT_STREAMS,
     // ... existing type exports stay
   } from "./streaming-types";
   ```

   Note: `IDLE_SLICE_DEFAULTS` was previously not re-exported because no consumer needed it externally. It still doesn't need to be — leave the existing re-export shape untouched and add only `MAX_CONCURRENT_STREAMS` as a new value export. (Type-only re-exports stay separate from value-only re-exports.)

**Verify:**

- `npx tsc --noEmit` passes.
- `grep -n "MAX_CONCURRENT_STREAMS" lib app components` — definition in `streaming-types.ts`, re-export in `index.ts`, consumer hits in `streaming-actions.ts` (and Increment 2 will add `chat-input.tsx`).
- Unit-style sanity check: in DevTools, manually call `startStream` 6 times for the same workspace; the 6th call should emit the warn log and not seed a slice. (Optional — covered by Increment 3's manual smoke test.)

**Forward compatibility:** `countActiveStreams` is intentionally local (not exported) — it duplicates a small portion of `useActiveStreamIds`'s logic from `streaming-hooks.ts`, but the hook can't be called from a non-React context. Two implementations of the same predicate aren't ideal; the principled fix is to extract a shared `slices.filter(predicate)` utility from the store. *Deferred to Part 6's cleanup pass* — Part 3 ships the duplication intentionally, the audit pass will flag it explicitly so Part 6 has a target to address.

---

### Increment 2 — Wire cap into `chat-input`

**What:** Update `chat-input.tsx` to gate Send by the workspace's active-stream count in addition to the existing per-conversation `streamState` rule. Render the locked PRD wording as an inline message above the disabled Send button when the cap is reached. Thread `teamId` from `chat-page-content.tsx` → `chat-area.tsx` → `chat-input.tsx`.

**Files changed:**

| File | Action |
|------|--------|
| `app/chat/_components/chat-input.tsx` | **Modify** — accept `teamId: string \| null` prop; consume `useActiveStreamCount(teamId)` and `MAX_CONCURRENT_STREAMS`; compute `isAtCap`; new disable condition for Send; render inline blocking message when at cap and not currently streaming this conversation |
| `app/chat/_components/chat-area.tsx` | **Modify** — accept `teamId` prop; pass through to `<ChatInput />` |
| `app/chat/_components/chat-page-content.tsx` | **Modify** — pass `teamId` (already in scope from `useAuth`) to `<ChatArea />` |

**Implementation details:**

1. **Disable-rule update in `chat-input.tsx`.** The existing logic gates Send by `isStreaming` (this conversation streaming) and empty-input. Add a third gate:

   ```ts
   import { useActiveStreamCount, MAX_CONCURRENT_STREAMS } from "@/lib/streaming";

   // Inside the component, where the existing isStreaming derivation lives:
   const activeStreamCount = useActiveStreamCount(teamId);
   const isAtCap =
     !isStreaming && activeStreamCount >= MAX_CONCURRENT_STREAMS;

   // The cap only blocks NEW streams. If this conversation is already
   // streaming, the user can still cancel via the Stop button — that path
   // doesn't depend on the cap.

   const canSend =
     value.trim().length > 0 && !isStreaming && !isAtCap;
   ```

   Stop-button rendering is unchanged: `isStreaming` controls it, and when `isStreaming` is true `isAtCap` is false (by construction), so the two never collide.

2. **Inline blocking message.** Render only when `isAtCap` is true. Place it directly above the Send/Stop button row, mirroring the existing "archived unarchive bar" placement so it visually fits the same banner slot:

   ```tsx
   {isAtCap && (
     <div
       className="px-3 py-2 text-xs text-[var(--text-muted)] bg-[var(--surface-muted)] border-t border-[var(--border)]"
       role="status"
       aria-live="polite"
     >
       Already running {MAX_CONCURRENT_STREAMS} chats — wait until one of them completes before starting another.
     </div>
   )}
   ```

   Notes on this snippet:
   - Wording: locked by PRD P3.R3, templated from the constant so cap-value drift is impossible.
   - Tokens: uses CSS custom properties already in `globals.css` (`--text-muted`, `--surface-muted`, `--border`) — no hardcoded colors per CLAUDE.md.
   - A11y: `role="status"` + `aria-live="polite"` so screen readers announce the cap state without interrupting the user's typing flow. Per CLAUDE.md "Pure visual cues are not the only signal."
   - Placement: above the Send button visually, but below the textarea. Final placement (above textarea vs. between textarea and button row) is a small aesthetic choice — both satisfy P3.R3's "rendered above the disabled Send button"; pick whichever sits cleanest in the existing layout. The TRD does not pin this micro-decision.

3. **Prop threading.** Three files, one prop:

   - **`chat-input.tsx`**: add `teamId: string \| null` to `ChatInputProps`. Wire it into the `useActiveStreamCount` call.
   - **`chat-area.tsx`**: add `teamId: string \| null` to its props; pass it down to `<ChatInput teamId={teamId} ... />`.
   - **`chat-page-content.tsx`**: at the existing `<ChatArea ... />` call site, add `teamId={teamId}` (the variable already exists at line 46 — `const teamId = activeTeamId ?? null;`).

   No type-safety risk: `teamId` is `string | null` end-to-end, matches the existing convention used by `useChat` and `useConversations`.

**Verify:**

- `npx tsc --noEmit` passes.
- The Send button is disabled and the inline message appears when the user has 5 streams running in the current workspace and tries to start a 6th.
- The Send button is unaffected when the user has 5 streams running in *another* workspace (cross-workspace isolation per Part 5 — already enforced by `useActiveStreamCount(teamId)`'s `teamId` filter).
- Existing behavior preserved: Send disabled while typing nothing; Stop button shown while this conversation streams; per-conversation gating works identically across all conversations.
- Manual smoke test (the P3 acceptance battery from the PRD):
  - **P3.R1**: open conversations A and B in two browser tabs (or via sidebar navigation). Send in A. Send button in B is *enabled* (different conversation). Stop button only on A.
  - **P3.R2**: trigger a slow stream in A, switch to B, send a quick query. Both stream concurrently; both message bubbles appear in their correct conversations server-side and on return.
  - **P3.R3**: trigger 5 concurrent streams. Try to start a 6th — Send is disabled, the locked message appears above it. Cancel one — Send becomes enabled again.
  - **P3.R4**: complete a stream in A while viewing B. Navigate back to A — message is present.
  - **P3.R5**: with two streams running, cancel A — A's bubble switches to `cancelled` status; B continues streaming.

**Forward compatibility:** Part 4 will add the conversations-sidebar footer text *"N chats are streaming"* / *"Start a conversation"*. That uses the same `useActiveStreamCount(teamId)` hook this increment now consumes. Part 5's AppSidebar dot pulses on `useActiveStreamCount(teamId) > 0`. All three consumers share one Part-1 hook — adding more surfaces in later parts is `useActiveStreamCount(teamId)` plus presentation, no new module API.

---

### Increment 3 — End-of-part audit + manual verification

**What:** The audit pass per CLAUDE.md "End-of-part audit" + the post-merge documentation updates. Specifically calls out the `countActiveStreams` / `useActiveStreamCount` duplication introduced by Increment 1 as a known item for Part 6 to address.

**Files changed:** Audit may produce code fixes in `chat-input.tsx`, `chat-area.tsx`, or the streaming module. Documentation:

| File | Action |
|------|--------|
| `ARCHITECTURE.md` | **Modify** — `chat-input.tsx` description gains a note about cap gating; `chat-area.tsx` description notes the `teamId` prop pass-through; the `lib/streaming/` block notes `MAX_CONCURRENT_STREAMS` |
| `CHANGELOG.md` | **Add entry** — `PRD-024 P3: enable multiple concurrent chat streams per user with a cap of 5` |

**Audit checklist (per CLAUDE.md, applied to Increments 1–2):**

1. **SRP** — `chat-input.tsx` owns "input editor + Send/Stop button + cap-blocked banner" (one cohesive UX surface). The cap gate is a derived condition, not a separate concern. `streaming-actions.ts`'s `countActiveStreams` is a private helper for the cap defense, not a public API.
2. **DRY** — `countActiveStreams` (local helper) and `useActiveStreamIds`'s computeActiveStreamIds (in `streaming-hooks.ts`) duplicate the "filter slices by `teamId === teamId && streamState === 'streaming'`" predicate. **Flag this in the audit output explicitly**: Part 6 should extract a shared predicate (or a cached non-React selector) so the cap defense and the React hook share one source. Two implementations of the same logic ship in this part as a deliberate scope-cap; the audit names them so Part 6 has a target.
3. **Design tokens** — The inline cap message uses `var(--text-muted)`, `var(--surface-muted)`, `var(--border)`. Verify these tokens already exist in `globals.css`; if not, the message should reuse the same tokens the existing "archived unarchive bar" uses (consistency-by-precedent). Zero hardcoded colors / spacing.
4. **Logging** — `streaming-actions.ts`'s cap defense uses `console.warn` with `[streaming]` prefix and includes `count/max` context. Sufficient for diagnosing UI bypass bugs.
5. **Dead code** — Verify nothing was left unused. `countActiveStreams` is only used in `startStream`. `MAX_CONCURRENT_STREAMS` is used in `streaming-actions.ts` (defense), `chat-input.tsx` (gate), and the templated message string. No commented-out residue.
6. **Convention** — `chat-input.tsx`'s prop interface gains `teamId` in the project-standard `string | null` shape. `MAX_CONCURRENT_STREAMS` is `UPPER_SNAKE_CASE` per CLAUDE.md naming table. Imports follow project order. A11y attributes (`role`, `aria-live`) are present on the cap banner.

**Manual verification — the P3 acceptance battery (also in Increment 2's verify section; reproduced here as the audit gate):**

- [ ] P3.R1 — Send is disabled and becomes Stop only on the conversation whose stream is active. Other conversations remain sendable.
- [ ] P3.R2 — Two streams run in parallel: each emits deltas independently; the chat-area shows the correct stream when displayed; both messages are persisted to the correct conversations.
- [ ] P3.R3 — Hitting the 5-stream cap surfaces the locked inline message above Send; Send remains disabled until a slot frees up. The defensive guard in `startStream` also fires (confirmed by warn-log) if any future caller bypasses the gate.
- [ ] P3.R4 — A stream completed while the user was viewing a different conversation produces a message visible on return — verified via DB inspection and navigation.
- [ ] P3.R5 — Cancelling A while B is also streaming leaves B alive; A's partial content is preserved as a cancelled message.

This audit produces fixes in the same PR, not a separate report.

### After Part 3 completes

Per CLAUDE.md ("After each TRD part completes"):

1. **`ARCHITECTURE.md` update** — note the cap mechanism in the streaming-module block; update `chat-input.tsx`'s description to reflect cap gating.
2. **`CHANGELOG.md` entry** — *PRD-024 P3: enable multiple concurrent chat streams per user; soft cap of 5 enforced client-side via UI gate + defensive runtime guard*.
3. **No DB schema change** — no Supabase types regen.
4. **Test affected flows** — covered by the manual smoke test battery above.

---

# Part 4
## Part 4 — Sidebar Streaming Indicators

This part covers P4.R1 through P4.R6 from the PRD. **Three indicator surfaces inside the conversations sidebar** are wired up to the same Part-1 store: per-conversation dots on each entry (pulsating during streaming, solid for unseen completions), aggregate footer text reflecting workspace-wide streaming count, and the consumer-side acknowledgment that clears the unseen flag on navigation. The slice's `hasUnseenCompletion` field — designed in Part 1 specifically for this purpose — finally gets its lifecycle wired.

Most of the data surface already exists. `useActiveStreamIds(teamId)`, `useActiveStreamCount(teamId)`, and `useUnseenCompletionIds(teamId)` were built in Part 1 with this exact use case in mind. `markConversationViewed(id)` already exists too. **Part 4's only new public-API addition** is `useHasUnseenCompletion(id: string \| null): boolean` — the per-conversation symmetric counterpart to `useIsStreaming(id)`. Everything else is wiring.

**Database models:** None.
**API endpoints:** None.
**Frontend pages/components:** `app/chat/_components/conversation-item.tsx` (per-entry dot + aria-label), `app/chat/_components/conversation-sidebar.tsx` (footer text + new `teamId` prop), `app/chat/_components/chat-page-content.tsx` (one prop pass-through + two `markConversationViewed` call sites).
**New module addition:** `useHasUnseenCompletion(id)` hook in `streaming-hooks.ts`, re-exported via the barrel.
**Streaming-module behavior change:** the `hasUnseenCompletion` flag now flips to `true` whenever a slice gains a `finalMessage` (completion + cancellation paths in `streaming-actions.ts`). Currently the flag exists on the slice but never transitions — Part 4 makes it live.
**`useChat` change:** the `useLayoutEffect` fold in `use-chat.ts` now calls `markConversationViewed` alongside `markFinalMessageConsumed`. Self-correcting cleanup: when a stream completes while the user is viewing the conversation, the unseen flag never persists.

### Architectural pivot — "always set, consumer clears"

The central design decision is **how does the slice decide whether to set `hasUnseenCompletion = true`?** Two approaches exist:

- **Option A (rejected): Inspect viewers.** The streaming module asks "is anyone currently subscribed to this slice?" before setting the flag. Requires the store to track active subscribers, which adds coupling and complexity. `useSyncExternalStore` doesn't expose subscriber identity.
- **Option B (chosen): Always set the flag at completion; let consumers clear it.** The streaming module unconditionally sets `hasUnseenCompletion = true` whenever `finalMessage` is set. Three independent paths clear the flag: (1) `useChat`'s fold (when the user is actively viewing the conversation, the fold runs synchronously after the slice update and immediately calls `markConversationViewed`); (2) `chat-page-content`'s `navigateToConversation` (when the user clicks a sidebar entry, the flag clears before `useChat` even mounts); (3) the popstate handler (when the user uses browser back/forward to enter a conversation).

Option B is **simpler, self-correcting, and reuses an existing primitive** (`markConversationViewed`). The flag sits in a stable terminal state — either `true` (unseen) or `false` (cleared by some consumer). The "viewer detection" question is implicitly answered by which clear path fires first: the fold for in-view, or the navigate path for navigate-in. Both are idempotent; concurrent calls are safe (a no-op if already cleared).

This is the predicted approach from Part 2's forward-compat note. Part 4 implements it.

### Architectural pivot — per-conversation hooks must select primitives

`useIsStreaming(id)` (Part 1) is built on top of `useStreamingSlice(id)`, which returns the slice object. The slice's reference changes on every `setSlice` call for that id — even on a content delta that doesn't change `streamState`. With many conversation items in the sidebar each subscribing to `useIsStreaming(itemId)` and `useHasUnseenCompletion(itemId)`, naïvely returning derived primitives on top of `useStreamingSlice` would mean: every delta in any conversation triggers a re-render of every same-conversation sidebar item, even when the boolean it cares about didn't change.

`useHasUnseenCompletion(id)` is added as a **direct `useSyncExternalStore` consumer with a primitive selector**, bypassing `useStreamingSlice`. The store's `subscribe` notifies on every mutation (broadcast); each hook's `getSnapshot` returns the boolean directly; React's `Object.is` comparison sees the same primitive value and bails out of the re-render. Net result: a `delta` event in conversation A produces zero re-renders in B's sidebar item.

For consistency and to lock in the pattern, the TRD also specifies that **`useIsStreaming` is refactored to the same primitive-selector shape** in Part 4 Increment 1 — a small follow-on to Part 1 that aligns the two per-conversation hooks. ~3 LOC change. Worth doing now because Part 4 is the first part where many simultaneous subscribers to these hooks exist (one per visible sidebar entry).

### Architectural pivot — accessibility through cohesion

The PRD (P4.R5) requires keyboard- and screen-reader-accessible indicators. Two competing approaches:

- **Separate the dot's role.** Give the dot `role="status"` + `aria-label="Generating response"`. Screen readers announce both the conversation title AND the dot's status as separate elements.
- **Cohere into the entry's a11y label.** Mark the dot decorative (`aria-hidden="true"`); extend the conversation entry's `aria-label` to include the state ("Conversation X, generating response" / "Conversation X, new unread response").

**The cohesion approach wins** — screen readers read the entry as one logical thing instead of fragmenting it into title + dot. Keyboard navigation also benefits: focus lands on the entry, screen reader announces full state in one breath, user moves on. Pinned in Increment 2.

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Module additions: `useHasUnseenCompletion` + lifecycle flag flip + `useIsStreaming` selector refactor + `useChat` fold update | `streaming-hooks.ts`, `streaming-actions.ts`, `streaming/index.ts`, `lib/hooks/use-chat.ts` | small |
| 2 | Per-conversation indicator (P4.R1, R2, R3, R5) | `conversation-item.tsx` | small |
| 3 | Sidebar footer + viewed-acknowledgment wiring (P4.R4, R6) | `conversation-sidebar.tsx`, `chat-page-content.tsx` | small |
| 4 | End-of-part audit + manual verification | docs + audit fixes | small |

Each increment is independently shippable. Increment 1 lands the module behavior with no UI changes — sidebar is unchanged after this increment. Increments 2 and 3 surface the indicator UX. Increment 4 closes the part.

---

### Increment 1 — Module additions + lifecycle flag flip

**What:** Add `useHasUnseenCompletion(id)` hook (selector-based, primitive snapshot). Refactor `useIsStreaming(id)` to the same shape. Make `runStream`'s completion path and `cancelStream`'s cancelled-bubble path set `hasUnseenCompletion: true` on the slice. Update `useChat`'s `useLayoutEffect` fold to call `markConversationViewed` alongside `markFinalMessageConsumed`.

**Files changed:**

| File | Action |
|------|--------|
| `lib/streaming/streaming-hooks.ts` | **Modify** — add `useHasUnseenCompletion(id: string \| null): boolean`; refactor `useIsStreaming(id: string \| null): boolean` to use direct `useSyncExternalStore` with a boolean selector |
| `lib/streaming/streaming-actions.ts` | **Modify** — `runStream`'s completion-time `setSlice` adds `hasUnseenCompletion: true`; `cancelStream`'s cancelled-with-content `setSlice` adds `hasUnseenCompletion: true` |
| `lib/streaming/index.ts` | **Modify** — re-export `useHasUnseenCompletion` |
| `lib/hooks/use-chat.ts` | **Modify** — `useLayoutEffect` fold imports and calls `markConversationViewed` alongside the existing `markFinalMessageConsumed` |

**Implementation details:**

1. **`useHasUnseenCompletion` in `streaming-hooks.ts`** (place near `useIsStreaming`):

   ```ts
   /**
    * True when this conversation has a completed/cancelled response that
    * the user hasn't yet viewed. Cleared by `markConversationViewed` (called
    * by useChat's fold on in-view completion AND by chat-page-content on
    * navigation into the conversation).
    *
    * Uses a primitive selector over useSyncExternalStore so subscribers to
    * conversation A don't re-render on deltas in conversation B.
    */
   export function useHasUnseenCompletion(id: string | null): boolean {
     return useSyncExternalStore(
       subscribe,
       () => (id ? getSlice(id)?.hasUnseenCompletion ?? false : false),
       () => false
     );
   }
   ```

2. **`useIsStreaming` refactor to the same shape** (lock in the pattern):

   ```ts
   export function useIsStreaming(id: string | null): boolean {
     return useSyncExternalStore(
       subscribe,
       () => (id ? getSlice(id)?.streamState === "streaming" : false),
       () => false
     );
   }
   ```

   The pre-Part-4 implementation read through `useStreamingSlice(id)` and derived a boolean — the slice's reference changed on every delta, forcing same-conversation subscribers to re-render even when the boolean didn't change. The refactored version's `getSnapshot` returns a primitive; React's Object.is comparison bails out the re-render when the value didn't change. ~3 LOC change.

3. **`runStream` completion-time flag flip** in `streaming-actions.ts`:

   The current completion path:

   ```ts
   setSlice(conversationId, {
     streamState: "idle",
     streamingContent: "",
     statusText: null,
     finalMessage,
   });
   ```

   gains one field:

   ```ts
   setSlice(conversationId, {
     streamState: "idle",
     streamingContent: "",
     statusText: null,
     finalMessage,
     hasUnseenCompletion: true,
   });
   ```

   Same change for `cancelStream`'s cancelled-with-content branch (the `else` branch in `cancelStream` doesn't set `finalMessage`, so it doesn't need to set the flag — there's nothing to "view"). The error path in `runStream`'s catch doesn't set `finalMessage` either, so no flag flip there.

4. **Barrel export in `index.ts`**:

   ```ts
   export {
     useStreamingSlice,
     useIsStreaming,
     useActiveStreamIds,
     useActiveStreamCount,
     useUnseenCompletionIds,
     useHasAnyUnseenCompletion,
     useHasUnseenCompletion, // <-- new
   } from "./streaming-hooks";
   ```

5. **`useChat` fold update** in `lib/hooks/use-chat.ts`:

   The current fold:

   ```ts
   useLayoutEffect(() => {
     if (!slice?.finalMessage) return;
     const completed = slice.finalMessage;
     setMessages((prev) => [...prev, completed]);
     markFinalMessageConsumed(slice.conversationId);
     console.log(`${LOG_PREFIX} folded finalMessage ...`);
   }, [slice?.finalMessage, slice?.conversationId]);
   ```

   gains one line — call `markConversationViewed` alongside `markFinalMessageConsumed`:

   ```ts
   useLayoutEffect(() => {
     if (!slice?.finalMessage) return;
     const completed = slice.finalMessage;
     setMessages((prev) => [...prev, completed]);
     markFinalMessageConsumed(slice.conversationId);
     // The user is actively viewing this conversation when the fold runs —
     // the unseen flag (set unconditionally at completion-time) is cleared
     // immediately so the sidebar entry doesn't show a stale solid dot.
     markConversationViewed(slice.conversationId);
     console.log(`${LOG_PREFIX} folded finalMessage ...`);
   }, [slice?.finalMessage, slice?.conversationId]);
   ```

   Add `markConversationViewed` to the existing import block from `@/lib/streaming`.

**Verify:**

- `npx tsc --noEmit` passes.
- Manually trigger a stream and observe (DevTools "Components" tab or console-debug) that `slice.hasUnseenCompletion` flips to `true` on completion, then immediately flips to `false` via the fold's `markConversationViewed` call.
- Trigger a stream in conversation A while viewing B. After completion, A's slice has `hasUnseenCompletion: true`. B's slice is untouched.
- `useIsStreaming` and `useHasUnseenCompletion` both compile and return the right booleans across slice transitions.

**Forward compatibility:** Increment 2 consumes both hooks per-conversation. Increment 3 needs no module changes (uses Part-1 aggregate hooks already). Part 5 (Cross-Page Stream Survival) consumes `useHasAnyUnseenCompletion(teamId)` for the AppSidebar dot — same lifecycle, no further module changes. Part 6 absorbs the `countActiveStreams` / `computeActiveStreamIds` predicate duplication flagged in Part 3's audit.

---

### Increment 2 — Per-conversation indicator on sidebar entries

**What:** Render a single brand-accent dot on each conversation entry that's either streaming (pulsating) or completed-but-unseen (solid). Decorate the dot as visual-only (`aria-hidden="true"`) and extend the conversation entry's existing `aria-label` to describe the state, so screen readers read the entry as one cohesive announcement.

**Files changed:**

| File | Action |
|------|--------|
| `app/chat/_components/conversation-item.tsx` | **Modify** — subscribe to `useIsStreaming(conversation.id)` and `useHasUnseenCompletion(conversation.id)`; render dot conditionally; extend `aria-label` to include state |

**Implementation details:**

1. **Subscribe to the per-conversation hooks at the top of the component:**

   ```tsx
   import { useIsStreaming, useHasUnseenCompletion } from "@/lib/streaming";

   const isStreaming = useIsStreaming(conversation.id);
   const hasUnseenCompletion = useHasUnseenCompletion(conversation.id);
   const showDot = isStreaming || hasUnseenCompletion;
   ```

   Both hooks bail out of re-renders on irrelevant store changes (per Increment 1's selector refactor).

2. **Render the dot** as a single element with conditional class:

   ```tsx
   {showDot && (
     <span
       aria-hidden="true"
       className={cn(
         "size-2 shrink-0 rounded-full bg-primary",
         isStreaming && "animate-pulse"
       )}
     />
   )}
   ```

   Decisions baked in:
   - `bg-primary` — uses the project's existing brand-accent token (shadcn convention; the same token used elsewhere for primary surfaces). If a more specific brand token exists in `globals.css`, use that; the implementation can pick whichever matches the project's existing dot/accent precedent.
   - `animate-pulse` — Tailwind's built-in opacity-fade animation. Sufficient for the "pulsating" affordance; avoids introducing a custom keyframe.
   - `shrink-0` — prevents the dot from collapsing in narrow flex containers (e.g., the sidebar collapsed mobile state).
   - `size-2` (8px) — small enough to be unobtrusive next to the title, large enough to register at a glance. Same scale used elsewhere in shadcn projects for similar status dots.
   - Single element with conditional class, not two separate elements — when the slice transitions streaming → idle (with hasUnseenCompletion), the dot doesn't unmount-and-remount; it just loses `animate-pulse`. Smoother visual transition.

3. **Extend `aria-label`** on the conversation entry's interactive element (button/link). The current label is presumably `conversation.title`; extend it:

   ```tsx
   const ariaLabel = isStreaming
     ? `${conversation.title}, generating response`
     : hasUnseenCompletion
       ? `${conversation.title}, new unread response`
       : conversation.title;
   ```

   The dot is `aria-hidden`; this label carries the state. Screen readers announce "Acme onboarding, generating response" — one cohesive utterance instead of fragmenting title and status into separate elements.

4. **Placement of the dot** in the entry's flex layout: typically before or after the title, depending on existing visual hierarchy. The TRD doesn't pin micro-layout — the implementation should match the conversation-item's existing alignment (e.g., if other badges live to the right of the title, place the dot there too for consistency).

**Verify:**

- Trigger a stream in conversation A. Verify the pulsating dot appears next to A's sidebar entry (active list).
- Wait for completion while viewing B. Verify A's dot transitions to solid (no longer pulsating).
- Click A in the sidebar. Verify the dot disappears (markConversationViewed in Increment 3 will close this loop, but Increment 2's `hasUnseenCompletion=false` after navigation suffices to clear the dot once Increment 3 ships).
- Repeat with an archived conversation (P4.R3): the indicator should appear on archived entries identically. `conversation-item.tsx` is the same component for both lists — no extra work needed.
- Screen-reader test (VoiceOver / NVDA): navigate to a streaming entry; verify the announcement includes "generating response" or "new unread response" alongside the title.

**Forward compatibility:** Increment 3's `markConversationViewed` calls complete the lifecycle — between Increments 2 and 3, the dot may persist after a user navigates to a conversation (the fold from Increment 1 covers the in-view-completion case, but the navigate-into-stale case isn't yet wired). Both are needed to fully satisfy P4.R6. Shipping Increment 2 alone produces a partial UX.

---

### Increment 3 — Sidebar footer + viewed-acknowledgment wiring

**What:** Add a footer line to the conversations sidebar reflecting workspace-wide streaming status (P4.R4). Wire `markConversationViewed` calls into `chat-page-content.tsx`'s navigation paths so the unseen dot clears when the user opens a conversation (P4.R6 completion).

**Files changed:**

| File | Action |
|------|--------|
| `app/chat/_components/conversation-sidebar.tsx` | **Modify** — accept new `teamId: string \| null` prop; render footer line below the conversations list using `useActiveStreamCount(teamId)`; templated singular/plural |
| `app/chat/_components/chat-page-content.tsx` | **Modify** — pass `teamId` to `<ConversationSidebar />`; call `markConversationViewed(id)` inside `navigateToConversation` and inside the `popstate` handler when the parsed id is non-null |

**Implementation details:**

1. **Footer text in `conversation-sidebar.tsx`**:

   Place at the bottom of the sidebar's scrollable content (below the conversations list, separate from the "New chat" button). Use the same muted-text styling that the existing "AI-generated responses" disclaimer in `chat-input.tsx` uses, for visual consistency-by-precedent.

   ```tsx
   import { useActiveStreamCount } from "@/lib/streaming";

   const activeStreamCount = useActiveStreamCount(teamId);
   const footerText =
     activeStreamCount === 0
       ? "Start a conversation"
       : activeStreamCount === 1
         ? "1 chat is streaming"
         : `${activeStreamCount} chats are streaming`;

   // Place at sidebar footer:
   <p
     className="px-4 py-2 text-center text-xs text-muted-foreground"
     aria-live="polite"
   >
     {footerText}
   </p>
   ```

   Notes:
   - `aria-live="polite"` on the text element so screen readers announce count transitions without interrupting other speech. The text is short and announcing "3 chats are streaming" is informative without being noisy.
   - Templated with explicit singular/plural rather than a string-template `chat${count === 1 ? "" : "s"}` so future i18n is straightforward (the message catalog can swap `{count} chats are streaming` → its locale-aware equivalent).
   - The footer is always rendered — when count is 0, it shows the "Start a conversation" CTA-flavored text. The PRD intentionally treats this as the at-rest state, not an empty/hidden state.

2. **`teamId` prop threading** in `conversation-sidebar.tsx`:

   ```ts
   interface ConversationSidebarProps {
     // ... existing props
     teamId: string | null;
   }
   ```

   And in `chat-page-content.tsx` at the existing `<ConversationSidebar ... />` call site, add `teamId={teamId}` (already in scope — same pattern as Part 3's chat-area threading).

3. **`markConversationViewed` calls in `chat-page-content.tsx`**:

   The `navigateToConversation` callback (around line 143–150) gains one line:

   ```ts
   const navigateToConversation = useCallback(
     (id: string) => {
       window.history.pushState(null, "", `/chat/${id}`);
       clearMessages();
       setActiveConversationId(id);
       markConversationViewed(id);
     },
     [clearMessages]
   );
   ```

   The `popstate` handler (around line 178–186) gains the same line guarded on non-null id:

   ```ts
   useEffect(() => {
     function onPopState() {
       const id = parseConversationIdFromPath(window.location.pathname);
       clearMessages();
       setActiveConversationId(id);
       if (id) markConversationViewed(id);
       setIsMobileSidebarOpen(false);
     }
     window.addEventListener("popstate", onPopState);
     return () => window.removeEventListener("popstate", onPopState);
   }, [clearMessages]);
   ```

   Add `markConversationViewed` to the existing import from `@/lib/streaming`. (chat-page-content already imports `useAuth` and other things; `markConversationViewed` is a new import.)

   No call needed in `silentlyAssignConversationId` (the fresh-send first-confirmation path) — the conversation just got its uuid, no prior unseen state is possible.

   No call needed in `navigateToFreshChat` — fresh-chat target is `null`, no conversation to mark.

   No call needed for the URL-seeded `initialConversationId` on initial mount — the streaming module's slices start empty after a fresh page load (Part 5 R3: client-side state doesn't survive reload), so there's no unseen flag to clear.

**Verify:**

- After Increment 1 (slices flip the flag on completion), the sidebar entry for the source conversation shows a solid dot when the user wasn't viewing during completion.
- Click the conversation entry → markConversationViewed clears the flag → dot disappears in the same render commit as the navigation (both state changes batch).
- Use browser back to return to a previously-viewed conversation that's since received an unseen completion (e.g., user clicked away after viewing, the conversation streamed again somehow — unusual but valid). popstate handler fires, calls markConversationViewed, dot clears.
- Footer text updates reactively: send a message in any conversation → footer flips from "Start a conversation" to "1 chat is streaming". Cancel → flips back.
- Singular/plural correct: 1 stream → "1 chat is streaming"; 3 streams → "3 chats are streaming".
- Cross-workspace isolation (verifies P5.R5 forward-compat): start a stream in personal, switch to a team → footer text in team workspace says "Start a conversation" (count is 0 for the team).

**Forward compatibility:** Part 5's AppSidebar chat icon dot consumes `useActiveStreamCount(teamId)` and `useHasAnyUnseenCompletion(teamId)` — both Part 1 hooks, no Part-4 work to redo. The "footer text + per-entry dots + AppSidebar dot" form a three-tier indicator system across two surfaces (Parts 4 and 5); they share the same Part 1 hooks and Part 4 lifecycle (the unconditional `hasUnseenCompletion: true` set, the consumer-clears pattern). No coordination logic needed.

---

### Increment 4 — End-of-part audit + manual verification

**What:** The audit pass per CLAUDE.md "End-of-part audit" + the post-merge documentation updates.

**Files changed:** Audit may produce code fixes in any of the four files modified by Increments 1–3. Documentation:

| File | Action |
|------|--------|
| `ARCHITECTURE.md` | **Modify** — `conversation-item.tsx` description gains a note about the per-conversation dot; `conversation-sidebar.tsx` description gains the footer; the streaming module block notes `useHasUnseenCompletion` |
| `CHANGELOG.md` | **Add entry** — `PRD-024 P4: sidebar streaming indicators (per-conversation pulsating/solid dots, aggregate footer text, navigate-to-clear lifecycle)` |

**Audit checklist (per CLAUDE.md, applied to Increments 1–3):**

1. **SRP** — `conversation-item.tsx` owns "render one conversation row, including its status indicator" (one cohesive surface). `conversation-sidebar.tsx` adds a footer that's consistent with its existing role (compose the conversations list). `streaming-actions.ts`'s lifecycle change is co-located with the existing `setSlice` calls — no new function added, just an extra field on existing setSlice payloads.
2. **DRY** — `useIsStreaming` and `useHasUnseenCompletion` share a structural pattern (subscribe + primitive selector). Worth verifying they don't duplicate inline — both are 3 LOC each, no extraction needed. The `markConversationViewed` import appears in two consumers (`use-chat.ts` and `chat-page-content.tsx`); each calls it for its own legitimate reason (in-view completion vs. navigate-in). No duplication. **Carry-over:** `countActiveStreams` / `computeActiveStreamIds` predicate duplication still flagged from Part 3 — Part 6 cleanup target.
3. **Design tokens** — The dot uses `bg-primary` + `animate-pulse` (project tokens). The footer uses `text-muted-foreground` + `text-xs` (project tokens). Zero hardcoded colors / spacing.
4. **Logging** — `streaming-actions.ts`'s slice-update with `hasUnseenCompletion: true` doesn't add a new log line (it's part of an existing setSlice). `markConversationViewed`'s existing log already fires on each clear. Sufficient observability.
5. **Dead code** — Verify the removed unconditional `useStreamingSlice` indirection in `useIsStreaming` doesn't leave an orphaned import or comment. Verify `useHasUnseenCompletion` is exported via `index.ts`.
6. **Convention** — Hooks named `use<Pascal>` per CLAUDE.md naming table. JSDoc on the new public-API hook. `aria-label` extension on the conversation entry uses the `${title}, ${state}` pattern (familiar to screen-reader users). Imports follow project order in all touched files.

**Manual verification — the P4 acceptance battery:**

- [ ] **P4.R1** — Pulsating brand-accent dot appears next to streaming conversations and disappears (or transitions to solid per P4.R2) on terminal state.
- [ ] **P4.R2** — Solid brand-accent dot appears on terminal state when the viewer is not on that conversation, persists across in-app navigation until the conversation is opened, then clears.
- [ ] **P4.R3** — Indicators work in both active and archived sidebar groups (`conversation-item.tsx` is shared between both lists; one-component change covers both).
- [ ] **P4.R4** — Footer text toggles between *"N chats are streaming"* (correct singular/plural for N=1 vs N>1) and *"Start a conversation"* based on aggregate streaming state in the current workspace.
- [ ] **P4.R5** — Screen-reader test: navigate to a streaming entry; announcement includes "generating response" or "new unread response" alongside the title; the dot itself is announced as nothing (aria-hidden); footer count changes are announced via aria-live="polite".
- [ ] **P4.R6** — Click-to-navigate to a streaming or unseen entry shows the live stream (or persisted message); cancellation works from the destination; the unseen-solid dot clears on selection (markConversationViewed runs synchronously before useChat re-keys).

This audit produces fixes in the same PR, not a separate report.

### After Part 4 completes

Per CLAUDE.md ("After each TRD part completes"):

1. **`ARCHITECTURE.md` update** — `conversation-item.tsx` description gains *"renders pulsating brand-accent dot when conversation is streaming, solid dot when conversation has unseen completed response (PRD-024 P4)"*. `conversation-sidebar.tsx` description gains *"aggregate streaming-status footer text via useActiveStreamCount(teamId)"*. The `streaming-hooks.ts` description in the module block lists `useHasUnseenCompletion` alongside the existing hooks.
2. **`CHANGELOG.md` entry** — Document the lifecycle decision (always-set + consumer-clears), the new public API (`useHasUnseenCompletion`), and the three-surface indicator system (per-entry dot, footer, fold-clears-flag).
3. **No DB schema change** — no Supabase types regen.
4. **Test affected flows** — covered by the manual smoke test battery above.

---

# Part 5
## Part 5 — Cross-Page Stream Survival

This part covers P5.R1 through P5.R5 from the PRD. **Four of five requirements are already structurally satisfied** by the architecture established in Parts 1–4. Part 5's only new code work is **the AppSidebar Chat icon dot** (P5.R2) — the third indicator surface, completing the indicator-system started in Part 4. Plus one defensive hardening for auth-state-expiry paths (P5.R4).

The structural satisfactions:

| Requirement | Mechanism (already in place) |
|---|---|
| **P5.R1 — Streams survive in-app navigation** | The streaming module is a **module-level singleton** (Part 1). `Map<conversationId, slice>`, listener `Set`, and `AbortController` map all live as module exports — independent of the React tree. Navigating from `/chat` to `/dashboard` unmounts `ChatPageContent` and `useChat`, but the module-level state persists. The SSE loop inside `runStream` is a detached promise — it doesn't observe React lifecycle. Streams continue to run; their slices accumulate deltas; on return to `/chat`, the new `useChat` instance subscribes to the slice and reads its current state. **Already structurally true.** |
| **P5.R3 — Hard refresh / sign-out cancels client streams** | Hard refresh kills the JS bundle entirely → module re-initializes empty. Sign-out's `clearAllStreams` (Part 1 Increment 3) aborts every controller and drops every slice. **Already implemented.** |
| **P5.R4 — No leak across users on the same browser** | `clearAllStreams` runs in `auth-provider.signOut` between `clearActiveTeamCookie` and the redirect to `/login`. By the time the next user lands on `/login`, the streaming store is empty. **Already implemented;** Part 5 *hardens* this by also wiring `clearAllStreams` into the auth-state-change listener for non-`signOut` session-end paths (token-expiry, server-side revoke, multi-tab sign-out). |
| **P5.R5 — Workspace switch isolates UI without aborting streams** | Slices carry `teamId` (Part 1's slice shape). Every public hook (`useActiveStreamCount`, `useUnseenCompletionIds`, `useStreamingSlice` via the per-conversation routing, etc.) filters by the `teamId` argument. Switching workspaces changes which `teamId` callers pass; cross-workspace slices retain their state but produce zero UI in the wrong workspace. The SSE loop is `teamId`-agnostic — it runs to completion regardless. **Already structurally true.** |

The only one that needs new code:

| Requirement | What's new |
|---|---|
| **P5.R2 — AppSidebar Chat icon reflects global state** | Pulsating dot on the Chat nav icon when any stream is active in the current workspace; solid dot when no streams but unseen completions exist; no dot otherwise. Uses Part 1's `useActiveStreamCount(teamId)` and `useHasAnyUnseenCompletion(teamId)` — no new module API. |

**Database models:** None.
**API endpoints:** None.
**Frontend pages/components:** `components/layout/app-sidebar.tsx` (dot rendering on the Chat nav item + a11y).
**Auth-provider hardening:** `components/providers/auth-provider.tsx` (one defensive `clearAllStreams` call on session-null transitions).

### Architectural pivot — module-level state IS the survival mechanism

Cross-page survival is a feature most SPA architectures pay for via state-persistence layers (Redux + redux-persist, Zustand + persist middleware, localStorage rehydration, etc.). The streaming module avoids all of that complexity by being a **module-level singleton** — its data lives as long as the JS bundle is loaded.

This was implicit in Part 1's design (P1.R4: *"The context lives at app root. Streams started on `/chat/<id>` survive navigation between authenticated pages within the same session."*). Part 1's architectural choice — module-level Map / Set / function exports, no React Context — *was* the cross-page survival mechanism. Part 5 verifies that the implicit guarantee holds in practice.

The trade-off accepted in Part 1: hard refresh wipes everything (the bundle reloads). Part 5.R3 explicitly accepts this as the boundary; client-side resume from a still-running server stream is in the backlog, not in scope.

### Architectural pivot — the AppSidebar dot completes the three-tier system

After Part 4 + Part 5, the indicator system spans three surfaces, all reading from the same Part 1 store:

| Surface | Subscribes to | Visual states |
|---|---|---|
| **Conversation row** (per-entry, in `/chat`) | `useIsStreaming(id)`, `useHasUnseenCompletion(id)` (per-conversation primitive selectors) | Pulsating / solid / none |
| **Conversations sidebar footer** (in `/chat`) | `useActiveStreamCount(teamId)` | *"N chats are streaming"* / *"Start a conversation"* |
| **AppSidebar Chat icon** (every authenticated page) | `useActiveStreamCount(teamId)`, `useHasAnyUnseenCompletion(teamId)` (workspace-aggregate) | Pulsating / solid / none |

Same lifecycle semantics across all three (always-set + consumer-clears, established in Part 4). Same brand-accent token. Same a11y pattern (decorative dot + cohesive label on the parent interactive element). Same workspace filtering.

Part 5's dot is the **off-chat surface** — when the user is on `/dashboard`, `/capture`, `/settings`, etc., this is the only indication that streams or unseen responses exist. The conversations-sidebar footer and per-entry dots only render when the user is on `/chat`. The AppSidebar dot is the global "you have something happening" surface.

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | AppSidebar Chat nav dot + auth-state-change hardening | `components/layout/app-sidebar.tsx`, `components/providers/auth-provider.tsx` | small |
| 2 | End-of-part audit + P5 acceptance battery + docs | docs + audit fixes | small |

Two increments — Part 5 is the smallest of the parts because most requirements were structurally satisfied by earlier work.

---

### Increment 1 — AppSidebar Chat dot + auth-state-change hardening

**What:** Render a brand-accent dot overlay on the AppSidebar's Chat nav icon — pulsating when any stream is active in the current workspace, solid when no streams but unseen completions exist, no dot otherwise. Extend the Chat link's `aria-label` for cohesive screen-reader announcement. Separately, wire `clearAllStreams` into the auth-state-change listener so the streaming store is cleared on session-null transitions, not only on explicit `signOut`.

**Files changed:**

| File | Action |
|------|--------|
| `components/layout/app-sidebar.tsx` | **Modify** — subscribe to `useActiveStreamCount(teamId)` and `useHasAnyUnseenCompletion(teamId)` (with `teamId` from `useAuth().activeTeamId`); compute dot state; render absolutely-positioned dot overlay on the Chat nav icon; extend the Chat link's `aria-label` |
| `components/providers/auth-provider.tsx` | **Modify** — `onAuthStateChange` listener's `else` branch (session is null) also calls `clearAllStreams()` — defensive cleanup for non-`signOut` session-end paths (token-expiry, multi-tab sign-out, server revoke) |

**Implementation details:**

#### 1a. AppSidebar dot rendering

Subscribe to the Part 1 hooks at the top of `AppSidebar`:

```tsx
import { useAuth } from "@/components/providers/auth-provider";
import {
  useActiveStreamCount,
  useHasAnyUnseenCompletion,
} from "@/lib/streaming";

// Inside the component:
const { activeTeamId } = useAuth();
const teamId = activeTeamId ?? null;
const activeStreamCount = useActiveStreamCount(teamId);
const hasUnseen = useHasAnyUnseenCompletion(teamId);
const isStreaming = activeStreamCount > 0;
const showChatDot = isStreaming || hasUnseen;
```

Then on the Chat nav item — wrap the icon in a `relative` container so the dot can absolutely-position over it:

```tsx
<Link
  href="/chat"
  aria-label={
    isStreaming
      ? "Chat, response generating"
      : hasUnseen
        ? "Chat, new unread response"
        : "Chat"
  }
  className={/* existing nav-item classes */}
>
  <div className="relative">
    <ChatIcon className={/* existing icon classes */} aria-hidden="true" />
    {showChatDot && (
      <span
        aria-hidden="true"
        className={cn(
          "absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary",
          // Optional ring to lift the dot off the icon for contrast:
          "ring-2 ring-background",
          isStreaming && "animate-pulse"
        )}
      />
    )}
  </div>
  {/* existing label text (visible when sidebar is hover-expanded) */}
</Link>
```

Decisions baked in:

- **Same brand-accent token** (`bg-primary`) and same `animate-pulse` class as the conversation-item dot (Part 4). Visual consistency — one indicator system, three surfaces.
- **Absolute positioning** at `-top-0.5 -right-0.5` puts the dot in the top-right corner of the icon, which is the conventional badge location across operating systems and design systems. Slight overhang (`-top-0.5`, `-right-0.5`) gives the dot definition against the icon's outline.
- **Optional `ring-2 ring-background`** lifts the dot against the icon for contrast — particularly important for the dark theme. The implementation should verify visually; this is a standard pattern for icon badges and trivial to remove if the bare dot reads better.
- **Aria-label cohesion** — same approach as Part 4's conversation-item: dot is decorative (`aria-hidden`); the link's `aria-label` carries the state announcement. *"Chat, response generating"* / *"Chat, new unread response"* / *"Chat"* — three terminal strings, simple to maintain.
- **No new module API.** Both hooks already exist in Part 1. Part 5's only consumption is workspace-aggregate, exactly what these hooks provide.

The exact positioning + class details should match the AppSidebar's existing icon styling (icon size, padding, hover states). The TRD doesn't pin micro-layout — implementation matches the file's existing visual conventions.

#### 1b. Auth-state-change hardening

The `signOut` path already clears the streaming store (Part 1 Increment 3). But `signOut` is only one of several ways a session can end:

- **Token expiry** — Supabase JWTs expire; the SDK's `onAuthStateChange` fires with `session: null`.
- **Multi-tab sign-out** — user signs out in tab A; tab B's `onAuthStateChange` fires with `session: null` without going through that tab's `signOut` function.
- **Server revoke / admin force-logout** — same path.

In all three cases, the JS context survives but the user identity changes. Without explicit cleanup, the streaming store would retain user A's slices when user B (or no user) takes over. Strictly harmless in practice (UUIDs don't collide; no UI subscribes to the orphan slices), but defensive cleanup is the principled fix.

The existing listener:

```ts
const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
  setUser(session?.user ?? null);
  setIsLoading(false);
  if (session?.user) {
    fetchCanCreateTeam(supabase, session.user.id, setCanCreateTeam);
  } else {
    setCanCreateTeam(false);
  }
});
```

Add `clearAllStreams()` to the `else` branch:

```ts
const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
  setUser(session?.user ?? null);
  setIsLoading(false);
  if (session?.user) {
    fetchCanCreateTeam(supabase, session.user.id, setCanCreateTeam);
  } else {
    setCanCreateTeam(false);
    // Defensive cleanup (PRD-024 P5.R4) — clear streaming store on any
    // session-null transition, not just explicit signOut. Catches token
    // expiry, multi-tab sign-out, and server-side revocation. Idempotent
    // with signOut's existing call.
    clearAllStreams();
  }
});
```

`clearAllStreams` is already imported in this file (Part 1 Increment 3 added the import for `signOut`'s use). No new imports needed.

**Verify:**

- `npx tsc --noEmit` passes.
- Visual check: AppSidebar Chat icon shows pulsating dot during a stream; transitions to solid when stream completes off-chat; clears when user opens the conversation; no dot at idle.
- Cross-page check: start a stream on `/chat/<id>`, navigate to `/dashboard` — Chat icon dot is pulsating in the AppSidebar; navigate back to `/chat`, conversation indicators match.
- Multi-tab session-end: open the app in two tabs while signed in; sign out in tab 1; verify tab 2's `onAuthStateChange` fires with `session=null` and the streaming store clears. (DevTools Components tab can inspect the streaming module's `slices` Map; should be empty.)
- Screen-reader test: focus the Chat nav icon; announcement should include the state phrase when a stream is active or an unseen completion exists.

**Forward compatibility:**

- **Part 6 cleanup**: `countActiveStreams` (private in `streaming-actions.ts`) and `computeActiveStreamIds` predicate (in `streaming-hooks.ts`) duplication still flagged — Part 6 owns this.
- **Part 7 docs**: the Architecture section will get a dedicated subsection on the streaming context's role and the cross-page survival mechanism (module-level state). This part's audit just updates the file-map and CHANGELOG; the deeper narrative is Part 7's territory.
- **Backlog items unaffected**: cancel-all, toast notifications, server-side stream resume on reload, mobile-specific UX, per-conversation cooldown — all explicitly deferred from this PRD per the Backlog section.

---

### Increment 2 — End-of-part audit + manual verification + docs

**What:** The audit pass per CLAUDE.md "End-of-part audit" + the post-merge documentation updates. Also runs the **full P5 acceptance battery** since most requirements are observational rather than implementation-driven.

**Files changed:** Audit may produce code fixes in `app-sidebar.tsx` or `auth-provider.tsx`. Documentation:

| File | Action |
|------|--------|
| `ARCHITECTURE.md` | **Modify** — `app-sidebar.tsx` description gains *"renders brand-accent indicator dot on Chat nav icon — pulsating when any workspace stream is active, solid when only unseen completions exist (PRD-024 P5.R2)"*. `auth-provider.tsx` description (if listed) gains a note about the defensive `clearAllStreams` on session-null transitions |
| `CHANGELOG.md` | **Add entry** — `PRD-024 P5: cross-page stream survival, AppSidebar streaming dot, defensive cleanup hardening` |

**Audit checklist (per CLAUDE.md):**

1. **SRP** — `app-sidebar.tsx`'s Chat-icon dot rendering is co-located with the Chat nav item it decorates. The auth-state-change cleanup is co-located with the existing user/team state cleanup in the same `else` branch — single cleanup site for session-null transitions.
2. **DRY** — The dot rendering pattern is now used in two places (`conversation-item.tsx` from Part 4 and `app-sidebar.tsx` here). Both use `bg-primary`, conditional `animate-pulse`, `aria-hidden` decorative + parent `aria-label` cohesion. **Could extract a shared `<StreamingDot />` component** if a third surface is added later. For now, two inline inscriptions of ~5 LOC each is below the extraction threshold (CLAUDE.md: *"If the same UI pattern or logic appears in two or more places, extract it into a shared location"* — this is borderline). **Audit decision:** flag for follow-up if a third surface lands; leave inline for now to avoid premature abstraction. **Carry-over:** `countActiveStreams` / `computeActiveStreamIds` duplication still flagged for Part 6.
3. **Design tokens** — `bg-primary`, `animate-pulse`, `ring-2 ring-background` (if used). Zero hardcoded colors.
4. **Logging** — `clearAllStreams` already logs (Part 1). No new log lines needed.
5. **Dead code** — Verify no unused imports introduced.
6. **Convention** — `useX` hook calls; `aria-label` cohesion matches Part 4's pattern; design-token classes only.

**Manual verification — the P5 acceptance battery:**

- [ ] **P5.R1** — Start a stream on `/chat/<id>`. Navigate to `/dashboard`. Wait for stream to complete server-side (10–30s for a typical query). Return to `/chat/<id>`. Assistant message is present in the thread (either still streaming live or completed, depending on timing). The streaming-context survives the navigation.
- [ ] **P5.R2** — AppSidebar Chat icon dot:
  - Pulsating during any active stream in current workspace.
  - Solid when no active streams but unseen completions exist (e.g., off-chat completion that hasn't been viewed).
  - No dot when neither.
  - Dot present and accurate on every authenticated page (`/chat`, `/dashboard`, `/capture`, `/settings/*`).
- [ ] **P5.R3** — Refresh the browser during a stream. Verify on reload: no client-side stream resumes (slices Map is empty). The persisted assistant message (if completed server-side) appears on next chat load via the existing `messages` API.
- [ ] **P5.R4** — Sign out during a stream. Verify the streaming store is empty (DevTools Components tab can inspect via the module's debug surface, or instrument with a one-off log). Sign in as a different user. Verify no residual UI state from previous user.
- [ ] **P5.R5** — Start a stream in personal workspace. Switch to a team workspace via the workspace switcher. Verify the AppSidebar dot, the conversations-sidebar footer, and the per-conversation dots all clear (the team workspace has zero streams). Switch back to personal — indicators reflect the still-running or unseen-completed state correctly. Stream is **not aborted** by the workspace switch (verify via DevTools / network tab — the original conversation's SSE connection is still alive, or its assistant message is persisted server-side at completion).
- [ ] **Auth-state hardening** — Multi-tab session-end test: open the app in two tabs (tab A and tab B). Sign out in tab A. Verify tab B's streaming store is also cleared (via Components inspection or by attempting to start a stream in tab B and observing it fails because the user is logged out).

This audit produces fixes in the same PR, not a separate report. If the manual battery surfaces issues that aren't caused by the architecture but by minor wiring oversights, fix in this increment.

### After Part 5 completes

Per CLAUDE.md ("After each TRD part completes"):

1. **`ARCHITECTURE.md` update** — `app-sidebar.tsx` file-map description updated with the dot. Streaming-module section in the architecture narrative (the "Key Design Decisions" block, if Part 5 prefigures Part 7's full doc pass) gains a one-line note about cross-page survival via module-level state. The full streaming-context section is Part 7's job.
2. **`CHANGELOG.md` entry** — Document the AppSidebar dot, the auth-state hardening, and the verification of the four already-structural requirements (P5.R1, R3, R4, R5).
3. **No DB schema change** — no Supabase types regen.
4. **Test affected flows** — covered by the P5 acceptance battery in Increment 2.

---

# Part 6
## Part 6 — `useChat` Cleanup (subsumes PRD-023 P4)

This part covers P6.R1 through P6.R4 from the PRD. **Most of P6's intent is already satisfied as a side-effect of Parts 2–5.** What remains is the explicit LOC-reduction target for `useChat` (P6.R4: under 200 LOC) and the predicate-duplication cleanup that's been carried over from Part 3's and Part 5's audits.

The structural satisfactions:

| Requirement | Status |
|---|---|
| **P6.R1 — `useChat` is concise.** No streaming refs, abort controllers, SSE loops, or state machines. | ✅ **Already done.** Part 2 removed all streaming internals; the file has only message-list state plus a thin streaming-passthrough layer. The only thing missing is the LOC ceiling. |
| **P6.R2 — SSE parsing and follow-up extraction live in one place.** | ✅ **Already done.** Part 1 Increment 1 extracted `parseSSEChunk`, `stripFollowUpBlock`, and the follow-up regexes to `lib/utils/chat-helpers.ts`. Repo-wide grep confirms each pattern in exactly one source file. The streaming module's `runStream` and the server-side `chat-stream-service.ts` both import from the same source. |
| **P6.R3 — Dead code from the legacy hook is removed.** | ✅ **Already done.** Part 2's rewrite deleted the legacy SSE loop, `abortControllerRef`, `streamingContentRef`, `assistantMessageIdRef`, `parseSSEChunk` / `stripFollowUpBlock` imports — none remain in `use-chat.ts`. No commented-out residue. |
| **P6.R4 — `useChat` (or successor) under 200 LOC.** | ❌ **Not satisfied.** Post-Part-4 audit fixes, `use-chat.ts` is at **492 LOC**. ~150 LOC of that is JSDoc on the `UseChatReturn` interface (preserved verbatim per P2.R5); the remaining ~340 LOC is structural state + scaffolding. Decomposition is required. |

**Database models:** None.
**API endpoints:** None.
**Frontend pages/components:** No chat-surface component changes — `chat-area.tsx`, `chat-input.tsx`, etc. continue to consume the same `UseChatReturn` interface (P2.R5 preserved).
**Hook decomposition:** `lib/hooks/use-chat.ts` (492 LOC) splits into three:
- `lib/hooks/use-conversation-messages.ts` (new, ~150 LOC) — owns the message-list role.
- `lib/hooks/use-chat-streaming.ts` (new, ~180 LOC) — owns the streaming subscription + send/cancel/retry + fold + clear-unseen + pending-fallback role.
- `lib/hooks/use-chat.ts` (rewrite, ~80 LOC) — thin composer; same `UseChatReturn` shape.

**Streaming module cleanup (carry-over from Parts 3 + 5):** The predicate `slice.teamId === teamId && slice.streamState === "streaming"` currently appears in two source files (`streaming-actions.ts`'s `countActiveStreams` and `streaming-hooks.ts`'s `computeActiveStreamIds`). Extract a shared predicate + iteration helper.

### Architectural pivot — split `useChat` along its two natural concerns

`useChat` already does two distinct things post-Part-2:

1. **Message-list management** — load on conversationId change (with the prev-conversationId skip-refetch guard from Gap P9), paginate via `fetchMoreMessages`, expose `clearMessages` for in-app navigation, surface `isConversationNotFound` for cross-user UUID hits.
2. **Streaming subscription + actions** — read fields from the slice via `useStreamingSlice(subscriptionId)`, expose `sendMessage` / `cancelStream` / `retryLastMessage` that delegate to the streaming module, fold `slice.finalMessage` into `messages[]` via `useLayoutEffect`, clear `slice.hasUnseenCompletion` via the second `useLayoutEffect` from Part 4 audit, manage the `pendingConversationId` fresh-send fallback from Part 2 audit.

These concerns are **coupled** (send needs to push the optimistic user message into messages[]; retry needs to trim messages[]; fold appends to messages[]) but **separable** — the coupling is a small, well-defined seam: the streaming hook needs `setMessages` and `messages` from the message-list hook.

The composer (`useChat`) wires the seam:

```ts
function useChat(options: UseChatOptions): UseChatReturn {
  const messageList = useConversationMessages({ conversationId: options.conversationId });
  const streaming = useChatStreaming({
    conversationId: options.conversationId,
    teamId: options.teamId,
    onConversationCreated: options.onConversationCreated,
    setMessages: messageList.setMessages,
    messages: messageList.messages,
  });
  return { ...messageList, ...streaming };
}
```

Each sub-hook is focused, testable in isolation, and well under the 200-LOC ceiling. The composer itself is ~80 LOC including the JSDoc-preserved `UseChatReturn` interface (which the chat-surface components depend on per P2.R5).

### Architectural pivot — predicate consolidation in the streaming module

Three Part audits have flagged it; Part 6 owns the cleanup. The duplicated logic:

```ts
// streaming-actions.ts (Part 3 Increment 1):
function countActiveStreams(teamId: string | null): number {
  let count = 0;
  for (const slice of listSlices().values()) {
    if (slice.teamId === teamId && slice.streamState === "streaming") count++;
  }
  return count;
}

// streaming-hooks.ts (Part 1 Increment 2, refined Part 3 audit):
function computeActiveStreamIds(teamId: string | null): string[] {
  const out: string[] = [];
  for (const slice of listSlices().values()) {
    if (slice.teamId === teamId && slice.streamState === "streaming") {
      out.push(slice.conversationId);
    }
  }
  return out;
}
```

Same predicate, same iteration, different reduction (count vs. id list).

**The cleanup**: extract a predicate factory + a generic find helper to `streaming-store.ts`. Both consumers compose them:

```ts
// streaming-store.ts (new exports):
export function isStreamingForTeam(teamId: string | null) {
  return (slice: ConversationStreamSlice): boolean =>
    slice.teamId === teamId && slice.streamState === "streaming";
}

export function findSlicesWhere(
  predicate: (slice: ConversationStreamSlice) => boolean
): ConversationStreamSlice[] {
  const out: ConversationStreamSlice[] = [];
  for (const slice of slices.values()) {
    if (predicate(slice)) out.push(slice);
  }
  return out;
}

// streaming-actions.ts (caller):
function countActiveStreams(teamId: string | null): number {
  return findSlicesWhere(isStreamingForTeam(teamId)).length;
}

// streaming-hooks.ts (caller):
function computeActiveStreamIds(teamId: string | null): string[] {
  return findSlicesWhere(isStreamingForTeam(teamId)).map((s) => s.conversationId);
}
```

The intermediate array allocation per call (max 5 slices via the cap) is trivial. Predicate and iteration are now in exactly one place.

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Decompose `useChat` into `useConversationMessages` + `useChatStreaming` + thin composer | 2 new hook files, 1 rewrite | medium |
| 2 | Streaming-store predicate consolidation (carry-over from Parts 3 + 5) | `streaming-store.ts`, `streaming-actions.ts`, `streaming-hooks.ts` | small |
| 3 | End-of-part audit + verification + docs | docs + audit fixes | small |

Each independently shippable. Increment 1 is the bulk; Increment 2 is the small carry-over cleanup; Increment 3 closes the part.

---

### Increment 1 — Decompose `useChat`

**What:** Split `lib/hooks/use-chat.ts` (492 LOC) into three files:

- **`lib/hooks/use-conversation-messages.ts`** (new) — message-list role: `messages` / `isLoadingMessages` / `hasMoreMessages` / `isConversationNotFound` state, the load-messages effect (with the Gap P9 prev-conversationId skip-refetch guard intact), `fetchMoreMessages`, `clearMessages`. Exposes `setMessages` so the streaming hook can perform optimistic adds, retry trimming, and fold-completion appends.
- **`lib/hooks/use-chat-streaming.ts`** (new) — streaming role: `useStreamingSlice` subscription, derived passthrough fields, `pendingConversationId` fresh-send fallback, `sendMessage` / `cancelStream` / `retryLastMessage`, the two `useLayoutEffect`s (fold + clear-unseen).
- **`lib/hooks/use-chat.ts`** (rewrite) — thin composer: instantiates both sub-hooks, wires them together, returns the combined `UseChatReturn` shape that `ChatPageContent` and the chat-surface components consume unchanged.

**Files changed:**

| File | Action |
|------|--------|
| `lib/hooks/use-conversation-messages.ts` | **Create** — extracted message-list logic + load-messages effect + Gap P9 guard + pagination + clear |
| `lib/hooks/use-chat-streaming.ts` | **Create** — extracted streaming subscription + delegates + fold + clear-unseen + pending fallback |
| `lib/hooks/use-chat.ts` | **Rewrite** — thin composer with the preserved `UseChatReturn` interface |

**Implementation details:**

#### 1a. `useConversationMessages`

Owns the message-list state and effects. Returns the message-list slice of `UseChatReturn` plus the internal `setMessages` setter that the streaming hook needs.

Concrete shape:

```ts
interface UseConversationMessagesOptions {
  conversationId: string | null;
}

interface UseConversationMessagesReturn {
  messages: Message[];
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  isConversationNotFound: boolean;
  fetchMoreMessages: () => Promise<void>;
  clearMessages: () => void;
  // Internal: not part of UseChatReturn; consumed only by the composer
  // and useChatStreaming. Not exported in the barrel.
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}
```

Body: ~150 LOC. Contains:

- The four `useState` declarations (`messages`, `isLoadingMessages`, `hasMoreMessages`, `isConversationNotFound`).
- `messagesRef` (mirrors `messages.length` for the load-messages skip-refetch guard).
- `prevConversationIdRef` (Gap P9 transition detection).
- The load-messages `useEffect` — moved verbatim, including the `null` early return, the `prev === null && messagesRef.current.length > 0` skip guard, the `cancelled` flag, the 404 / `isConversationNotFound` branch, and the entry/exit logging.
- `fetchMoreMessages` (`useCallback`).
- `clearMessages` (`useCallback`).

The `setMessages` setter is exposed in the return object. Consumers outside `lib/hooks/` shouldn't import this hook directly — it's an internal building block. Verified by an audit-time grep: only `use-chat.ts` imports it.

#### 1b. `useChatStreaming`

Owns the streaming-subscription and action-delegate roles. Returns the streaming slice of `UseChatReturn`.

Concrete shape:

```ts
interface UseChatStreamingOptions {
  conversationId: string | null;
  teamId: string | null;
  onConversationCreated?: (id: string) => void;
  // Wired in from useConversationMessages — needed for optimistic adds
  // (sendMessage), trimming (retryLastMessage), and folding (useLayoutEffect).
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

interface UseChatStreamingReturn {
  sendMessage: (content: string) => Promise<void>;
  cancelStream: () => void;
  retryLastMessage: () => Promise<void>;
  streamState: StreamState;
  streamingContent: string;
  statusText: string | null;
  latestSources: ChatSource[] | null;
  latestFollowUps: string[];
  error: string | null;
}
```

Body: ~180 LOC. Contains:

- `pendingConversationId` state + `pendingConversationIdRef` ref-mirror + the auto-clear `useEffect`.
- `subscriptionId = conversationId ?? pendingConversationId`.
- `useStreamingSlice(subscriptionId)` subscription.
- The six derived passthrough fields (`streamState`, `streamingContent`, `statusText`, `latestSources`, `latestFollowUps`, `error`).
- `subscriptionIdRef` (for `cancelStream`'s stable callback identity, established Part 2 audit).
- `conversationIdRef` + `onConversationCreatedRef` ref-mirrors.
- `sendMessage` (`useCallback`) — generates UUIDs, optimistic-add via the threaded `setMessages`, calls `moduleStartStream`.
- `cancelStream` (`useCallback`) — calls `moduleCancelStream` via `subscriptionIdRef.current`.
- `retryLastMessage` (`useCallback`) — reads `messages` (threaded in), trims via `setMessages`, re-sends via the inner `sendMessage`.
- The two `useLayoutEffect`s — fold and clear-unseen, both unchanged from Part 4.

#### 1c. `useChat` (composer)

The new `use-chat.ts` is a thin composer. Approximately:

```ts
"use client";

// ---------------------------------------------------------------------------
// useChat — Composer that wires message-list and streaming sub-hooks (PRD-024)
// ---------------------------------------------------------------------------

import { useConversationMessages } from "./use-conversation-messages";
import { useChatStreaming } from "./use-chat-streaming";

import type { ChatSource, Message, StreamState } from "@/lib/types/chat";

interface UseChatOptions {
  conversationId: string | null;
  teamId: string | null;
  onConversationCreated?: (id: string) => void;
  onTitleGenerated?: (id: string, title: string) => void;
}

// UseChatReturn: see comprehensive JSDoc on each field — preserved verbatim
// from the pre-Part-6 file because chat-surface components depend on the
// documented contract (P2.R5).
interface UseChatReturn { /* ... 50 LOC of JSDoc'd fields ... */ }

export function useChat(options: UseChatOptions): UseChatReturn {
  const messageList = useConversationMessages({
    conversationId: options.conversationId,
  });

  const streaming = useChatStreaming({
    conversationId: options.conversationId,
    teamId: options.teamId,
    onConversationCreated: options.onConversationCreated,
    messages: messageList.messages,
    setMessages: messageList.setMessages,
  });

  return {
    // Message-list passthrough
    messages: messageList.messages,
    isLoadingMessages: messageList.isLoadingMessages,
    hasMoreMessages: messageList.hasMoreMessages,
    isConversationNotFound: messageList.isConversationNotFound,
    fetchMoreMessages: messageList.fetchMoreMessages,
    clearMessages: messageList.clearMessages,
    // Streaming passthrough
    sendMessage: streaming.sendMessage,
    cancelStream: streaming.cancelStream,
    retryLastMessage: streaming.retryLastMessage,
    streamState: streaming.streamState,
    streamingContent: streaming.streamingContent,
    statusText: streaming.statusText,
    latestSources: streaming.latestSources,
    latestFollowUps: streaming.latestFollowUps,
    error: streaming.error,
  };
}
```

Estimated final: ~80 LOC (interface JSDoc takes ~50 LOC; composer body ~30 LOC). **Comfortably under the P6.R4 200-LOC ceiling.**

The `onTitleGenerated` option is accepted for forward compatibility but unused (titles arrive via fire-and-forget server generation, discovered by `useConversations` refetch). Same comment from the pre-decomposition file is preserved.

**Verify:**

- `npx tsc --noEmit` passes.
- `wc -l lib/hooks/use-chat.ts` is **under 200**. The two new hooks are also each well-shaped (target: each under 200 LOC).
- `grep -rn "from \"@/lib/hooks/use-conversation-messages\"\|from \"@/lib/hooks/use-chat-streaming\"" app components lib` returns hits **only** in `lib/hooks/use-chat.ts` (the composer) — these are internal building blocks, not public API. If any chat-surface component imports them directly, that's a refactor regression to fix.
- Manual smoke test: every chat behavior from Parts 1–5 still works. The `UseChatReturn` shape consumed by `ChatPageContent` and the chat-surface components is byte-identical, so compilation is the first signal; functional verification covers send / abort / retry / fresh-chat / cross-conversation switch / fold + flicker-free completion / unseen-clear / cap behavior.

**Forward compatibility:**

- The internal hooks (`useConversationMessages`, `useChatStreaming`) are not re-exported from any barrel. They're implementation details of `useChat`. If a future feature needs *just* the message-list role (e.g., a read-only thread view in another surface), it could promote `useConversationMessages` to a barrel-exported hook at that time.
- Part 7's documentation will reference the new hook layout in the file map.

---

### Increment 2 — Streaming-store predicate consolidation

**What:** Extract the shared workspace+streaming predicate to `streaming-store.ts` so both `countActiveStreams` (in `streaming-actions.ts`) and `computeActiveStreamIds` (in `streaming-hooks.ts`) consume the same source of truth. Carries over the cleanup target flagged by Part 3's and Part 5's audits.

**Files changed:**

| File | Action |
|------|--------|
| `lib/streaming/streaming-store.ts` | **Modify** — add two exports: `isStreamingForTeam(teamId)` predicate factory, and `findSlicesWhere(predicate)` generic iteration+filter helper |
| `lib/streaming/streaming-actions.ts` | **Modify** — remove the inline `countActiveStreams` body; replace with one-liner using the new helpers |
| `lib/streaming/streaming-hooks.ts` | **Modify** — remove the inline `computeActiveStreamIds` body; replace with one-liner. The `stableFilteredIds` ref-stability machinery stays (it's a separate concern: cache + ref equality). The unseen-completion path can also adopt `findSlicesWhere` for consistency |

**Implementation details:**

1. **Add to `streaming-store.ts`** (alongside the existing `subscribe` / `getSlice` / `setSlice` exports):

   ```ts
   /**
    * Predicate factory: matches slices that are actively streaming in the
    * given workspace. Used by both the cap defense (streaming-actions.ts)
    * and the React hook layer (streaming-hooks.ts) so the workspace +
    * streaming-state filter has one source of truth.
    */
   export function isStreamingForTeam(teamId: string | null) {
     return (slice: ConversationStreamSlice): boolean =>
       slice.teamId === teamId && slice.streamState === "streaming";
   }

   /**
    * Generic iteration + filter over the slices Map. Single allocation;
    * caller specializes via predicate. Used by countActiveStreams,
    * computeActiveStreamIds, computeUnseenCompletionIds.
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
   ```

2. **Update `streaming-actions.ts`**:

   ```ts
   import {
     // ... existing imports ...
     findSlicesWhere,
     isStreamingForTeam,
   } from "./streaming-store";

   // Replace the inline countActiveStreams body:
   function countActiveStreams(teamId: string | null): number {
     return findSlicesWhere(isStreamingForTeam(teamId)).length;
   }
   ```

   The function still exists with the same name + signature; only the body changes. All call sites (the `startStream` defensive guard) stay unchanged.

3. **Update `streaming-hooks.ts`**:

   ```ts
   import {
     // ... existing imports ...
     findSlicesWhere,
     isStreamingForTeam,
   } from "./streaming-store";

   // Replace the inline computeActiveStreamIds body:
   function computeActiveStreamIds(teamId: string | null): string[] {
     return findSlicesWhere(isStreamingForTeam(teamId))
       .map((s) => s.conversationId);
   }
   ```

   The `stableFilteredIds` cache + ref-stability layer is unchanged — it operates on the result. Callers (`useActiveStreamIds`) are unchanged.

   For consistency, also adopt `findSlicesWhere` in `computeUnseenCompletionIds` (which has its own predicate `(s) => s.hasUnseenCompletion`). Same pattern, different predicate.

**Verify:**

- `npx tsc --noEmit` passes.
- `grep -rn "slice\.teamId === teamId && slice\.streamState === \"streaming\"" lib` returns hits in **exactly one source file** (`streaming-store.ts`) — the predicate factory's body. Both consumers now compose it.
- Cap defense (`startStream`) still fires correctly when at cap (tested via the P3 manual smoke test).
- Sidebar dot still shows correctly during streams (tested via the P4 manual smoke test).

**Forward compatibility:** `findSlicesWhere` is a generic primitive — future selectors (e.g., "find all slices with errors", "find all slices started before timestamp X") compose it with their own predicates, no further refactoring needed. The predicate factory pattern (`isStreamingForTeam(teamId) → predicate`) enables predicate composition in future, e.g., `isStreamingForTeam(teamId) AND startedAfter(t)`.

---

### Increment 3 — End-of-part audit + verification + docs

**What:** The audit pass per CLAUDE.md "End-of-part audit" + the post-merge documentation updates.

**Files changed:** Audit may produce code fixes in any of the touched files. Documentation:

| File | Action |
|------|--------|
| `ARCHITECTURE.md` | **Modify** — `lib/hooks/use-chat.ts` description rewritten to *"Composer that wires `useConversationMessages` + `useChatStreaming` (PRD-024 Part 6)"*. Add file-map entries for the two new hook files. The streaming-module description for `streaming-store.ts` notes the new selector exports |
| `CHANGELOG.md` | **Add entry** — `PRD-024 P6: useChat decomposition into focused sub-hooks; streaming-store predicate consolidation` |

**Audit checklist (per CLAUDE.md):**

1. **SRP** — Three hooks, each with one clear concern (message-list, streaming, composition). The streaming-store gains two new selector exports, both single-purpose (predicate factory, iteration+filter). The composer wires them via prop-threading (P2.R5 surface preserved).
2. **DRY** — The workspace+streaming predicate now exists in **exactly one source file**. Predicate composition is now possible (forward-compat for future selectors). The dot-rendering DRY borderline from Part 5 audit is **NOT extracted in this part** — the two surfaces (conversation-item, app-sidebar) still use different positioning + token systems; extraction would require larger token-system unification work outside Part 6's scope. **Re-flag for future cleanup if a third dot surface lands.**
3. **Design tokens** — N/A (no UI changes in this part).
4. **Logging** — Both new hooks preserve the `[useChat]` log prefix on equivalent operations. The streaming-store helpers are pure (no side effects, no logging needed).
5. **Dead code** — Verify the pre-decomposition `use-chat.ts`'s state declarations, refs, and effects are *all* either re-homed in one of the new hooks or deleted. No commented-out residue. Confirm the SSE parsing utilities still live in exactly one source file (`chat-helpers.ts`). Confirm no `parseSSEChunk` / `stripFollowUpBlock` / abort-controller / SSE-loop references in `use-chat.ts`.
6. **Convention** — kebab-case files; named exports only; both new hooks follow the project's hook-naming pattern (`useX`); imports follow project order; JSDoc on the public-API surface (`UseChatOptions`, `UseChatReturn`) preserved verbatim.

**Manual verification — the P6 acceptance battery:**

- [ ] **P6.R1** — `lib/hooks/use-chat.ts` has no streaming-related internals (the streaming logic lives in `useChatStreaming`; the message-list logic lives in `useConversationMessages`; the composer is pure wiring).
- [ ] **P6.R2** — Repo-wide grep for the follow-up regex pattern returns hits in **exactly one source module** (`lib/utils/chat-helpers.ts`). The streaming-actions module imports from it; the server-side `chat-stream-service.ts` imports from it.
- [ ] **P6.R3** — No dead imports, helpers, or refs remain in `use-chat.ts`. `git diff` against the pre-Part-6 file shows the legacy state was either re-homed or deleted; no commented-out residue.
- [ ] **P6.R4** — `wc -l lib/hooks/use-chat.ts` reports **under 200 LOC**.
- [ ] **Behavior parity** — Send + abort + retry + fresh-chat + cross-conversation switch + fold (flicker-free completion) + unseen-clear + per-workspace cap behavior all observable as in Parts 1–5. Run the smoke-test batteries from Parts 2–5 and confirm no regressions.

This audit produces fixes in the same PR, not a separate report. The decomposition is structural — most regressions would be type-check failures or shape mismatches, both caught by `tsc`.

### After Part 6 completes

Per CLAUDE.md ("After each TRD part completes"):

1. **`ARCHITECTURE.md` update** — File map gains `lib/hooks/use-conversation-messages.ts` and `lib/hooks/use-chat-streaming.ts`; `lib/hooks/use-chat.ts` description updated. The streaming-store entry mentions the new `isStreamingForTeam` / `findSlicesWhere` selector exports.
2. **`CHANGELOG.md` entry** — Document the decomposition (motivated by P6.R4), the predicate consolidation (carry-over from Parts 3 + 5), and the explicit non-fix for the dot-rendering DRY (re-flagged for future).
3. **No DB schema change** — no Supabase types regen.
4. **Test affected flows** — covered by the P6 acceptance battery + the cumulative Parts 1–5 smoke-test batteries.

---

# Part 7
## Part 7 — Documentation

This part covers P7.R1 through P7.R5 from the PRD. **Pure documentation pass — no code changes.** Aligns with CLAUDE.md's "End-of-PRD audit" prescription that runs after the final part of every PRD completes.

Most of P7's intent has been **partially satisfied incrementally** through Parts 1–6's audit-time docs updates: each part added file-map entries to `ARCHITECTURE.md` and a dated entry to `CHANGELOG.md`. Part 7 closes the remaining gaps:

| Requirement | Status pre-Part-7 |
|---|---|
| **P7.R1 — Streaming-context architecture section** | ❌ Not written. File-map entries exist piecemeal; there is no consolidated narrative covering role, placement, slice model, concurrency cap, cross-page survival, useChat consumption pattern, indicator system. |
| **P7.R2 — File map matches filesystem** | ⚠️ Partially satisfied. Each part added entries during its audit; needs a final walk against the actual filesystem to confirm zero diffs. |
| **P7.R3 — Key Design Decisions entry** | ❌ Not written. The existing Key Design Decisions list doesn't yet include the streaming-context choice rationale. |
| **P7.R4 — CHANGELOG entries for every completed part** | ⚠️ Partially satisfied. Parts 1–6 each added a dated entry; needs verification that all 6 are present and correctly worded. |
| **P7.R5 — PRD-023 P4 deferral reconciled** | ❌ Not addressed. PRD-023 has a Part 4 section that defers to PRD-024; the codebase / docs may have lingering "PRD-023 P4" references that should be updated or removed. |

**Database models:** None.
**API endpoints:** None.
**Frontend pages/components:** None.
**Documentation files touched:** `ARCHITECTURE.md`, `CHANGELOG.md`, `docs/023-codebase-cleanup/prd.md`, `docs/023-codebase-cleanup/trd.md` (if it exists). Possibly `docs/024-multi-stream-chat/prd.md` (linkbacks).

### Architectural pivot — documentation as the final structural step

The documentation pass is **not a write-up after the work** — it's a **structural step that locks in the architecture for future readers**. After Part 7:

- A new engineer reading `ARCHITECTURE.md` understands the streaming-context design without grepping the codebase.
- The file map serves as a navigable index; every file that exists is described, and only files that exist are listed.
- The Key Design Decisions section captures *why* the streaming context exists in this shape — preventing future drift toward "let's add a Provider" or "let's persist to localStorage" or "let's increase the cap to 50."
- The PRD-023 P4 deferral is reconciled — no stale references where the deferred work is still "TODO" in another doc.

This mirrors CLAUDE.md's discipline: *"`ARCHITECTURE.md` reflects what exists in the codebase — never pre-fill with planned-but-unbuilt structures."* Part 7 makes the post-implementation reality canonical.

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Streaming-context architecture section in `ARCHITECTURE.md` (P7.R1) | One new top-level section, ~80–120 lines of prose + tables | small |
| 2 | Key Design Decisions entry (P7.R3) | One new numbered entry in the existing list | tiny |
| 3 | File-map walk + CHANGELOG verification + PRD-023 P4 reconciliation (P7.R2, R4, R5) | Audit + targeted edits; net +/- a few lines per file | small |
| 4 | End-of-PRD audit (CLAUDE.md prescribed) | Cumulative audit checklist across all files touched by PRD-024 + final type-check + smoke-test gate | small |

Each increment is independently shippable. Increments 1 + 2 are content writing; Increment 3 is verification + cleanup; Increment 4 is the cumulative audit that closes the PRD.

---

### Increment 1 — Streaming-context architecture section

**What:** Add a new top-level section to `ARCHITECTURE.md` documenting the streaming context end-to-end. Single source of truth for future readers; covers role, placement, data shape, concurrency model, cross-page survival, and consumption patterns.

**Files changed:**

| File | Action |
|------|--------|
| `ARCHITECTURE.md` | **Modify** — add a new `## Streaming Context (PRD-024)` section, placed after the existing Data Model / Authentication sections and before (or alongside) the Key Design Decisions list |

**Section structure (proposed):**

```markdown
## Streaming Context (PRD-024)

> The chat-streaming subsystem owns all client-side state for in-flight and
> recently-completed AI responses. It's the source of truth for streaming
> bubbles, sidebar dots, the AppSidebar Chat icon dot, and the conversations-
> sidebar footer.

### Role and placement

The streaming context lives in `lib/streaming/` as a **module-level singleton**
— not a React Context. Its state (`Map<conversationId, ConversationStreamSlice>`,
listener `Set`, `Map<conversationId, AbortController>`) is module-scope, not
React-scope. This is the cross-page survival mechanism: navigating from
`/chat` to `/dashboard` unmounts every chat-related React component, but the
streaming state persists because the JS module is still loaded.

The store is wiped only by:
- Hard browser refresh (full bundle reload).
- `clearAllStreams()` called from `auth-provider`'s `signOut` and the
  `onAuthStateChange` session-null branch (covers token expiry, multi-tab
  sign-out, server-side revocation).

### Per-conversation slice model

Each conversation has its own `ConversationStreamSlice` (defined in
`lib/streaming/streaming-types.ts`):

| Field | Purpose |
|---|---|
| `conversationId`, `teamId` | Identity + workspace tag |
| `streamState` | `idle` / `streaming` / `error` |
| `streamingContent` | Accumulated content during streaming |
| `statusText` | Ephemeral tool-execution status |
| `latestSources`, `latestFollowUps` | Citations + chips from the latest stream |
| `error` | User-visible error message when streamState is `error` |
| `assistantMessageId` | UUID from `X-Assistant-Message-Id` response header |
| `hasUnseenCompletion` | True from terminal-state-with-content until viewed |
| `finalMessage` | Set on streaming→idle transition; consumed by `useChat`'s fold |
| `startedAt` | ms epoch for ordering / debug |

The slice carries every field any consumer needs in one place; React subscribers
read fields via primitive selectors (`useIsStreaming`, `useHasUnseenCompletion`)
or the full slice (`useStreamingSlice`).

### Public API surface

Defined in `lib/streaming/index.ts` (the module's barrel):

**Imperative actions** (called from event handlers, not React render):
- `startStream(args)` — kicks off the SSE loop for a conversation; defensive
  cap guard refuses if `count >= MAX_CONCURRENT_STREAMS`.
- `cancelStream(conversationId)` — aborts and writes the cancelled bubble
  to `slice.finalMessage`.
- `markConversationViewed(conversationId)` — clears `hasUnseenCompletion`.
- `markFinalMessageConsumed(conversationId)` — clears `finalMessage` after
  the consumer (useChat fold) folds it into the message list.
- `clearAllStreams()` — sign-out teardown.

**React hooks** (subscribe via `useSyncExternalStore`):
- Per-conversation primitive selectors: `useIsStreaming(id)`,
  `useHasUnseenCompletion(id)`, `useStreamingSlice(id)`.
- Workspace-scoped aggregates (cached for stable refs):
  `useActiveStreamIds(teamId)`, `useActiveStreamCount(teamId)`,
  `useUnseenCompletionIds(teamId)`, `useHasAnyUnseenCompletion(teamId)`.

**Selectors** (used by both action and hook layers — predicate consolidation):
- `isStreamingForTeam(teamId)`, `hasUnseenCompletionForTeam(teamId)` —
  predicate factories.
- `findSlicesWhere(predicate)` — generic iteration helper.

**Constants:**
- `MAX_CONCURRENT_STREAMS = 5`.

### Multi-stream concurrency

A user may run up to **5 concurrent streams per workspace** (cap defined by
`MAX_CONCURRENT_STREAMS`). Each conversation has its own SSE loop, its own
`AbortController`, its own slice — they're fully independent. Cancelling one
doesn't affect the others; completion in one doesn't block another.

The cap is enforced at two layers:
1. **UI gate** in `chat-area.tsx`'s `capReached` derivation, threaded to
   `chat-input.tsx`'s Send button (disabled + inline blocking message)
   AND `starter-questions.tsx`'s buttons (disabled).
2. **Defensive runtime guard** at the top of `startStream` (`streaming-actions.ts`).
   If a future caller bypasses the UI gate, the guard logs a warning and
   refuses without seeding a slice.

The cap is workspace-scoped: a user can have 5 personal streams + 5 team
streams simultaneously without either count blocking the other.

### Cross-page stream survival

Streams started on `/chat/<id>` continue running when the user navigates to
`/dashboard`, `/capture`, `/settings`, etc. The streaming module is at module
scope; the SSE loop in `runStream` is a detached promise with no React
lifecycle observation. On return to `/chat/<id>`, the new `useChat` instance
subscribes to the slice and reads its current state — either still streaming
(live bubble + Stop button) or completed (assistant message in the thread).

The boundary: **hard refresh wipes everything.** Client-side resume from a
still-running server stream is in the PRD backlog, not in scope.

### Workspace isolation

Slices carry `teamId`; every public hook filters by `teamId`. Switching
workspaces hides cross-workspace state from UI but does NOT abort in-flight
streams — they continue to run server-side; their slices remain in the
store and re-surface on switch back. Sign-out clears the entire store
(no leak across users on the same browser).

### `useChat` consumption pattern

`useChat` (`lib/hooks/use-chat.ts`) is a **thin composer** that wires two
focused sub-hooks:

- `useConversationMessages` (`lib/hooks/use-conversation-messages.ts`) —
  message-list state, load-on-conversation-change with the Gap P9 skip-
  refetch guard, pagination, clearMessages.
- `useChatStreaming` (`lib/hooks/use-chat-streaming.ts`) — slice subscription,
  streaming passthrough fields, `sendMessage` / `cancelStream` /
  `retryLastMessage` delegating to the streaming module, the `useLayoutEffect`
  fold for `finalMessage` (P2.R7 no-flicker swap), the `useLayoutEffect`
  clear-unseen for in-view auto-acknowledgment.

The composition seam is `setMessages` + `messages` threaded from
`useConversationMessages` to `useChatStreaming`. Three writers — optimistic
add (sendMessage), retry trim (retryLastMessage), fold append
(useLayoutEffect) — all flow through the single threaded `setMessages`
reference.

### Three-tier indicator system

After Parts 4 + 5, the streaming context surfaces in three UI tiers, all
reading from the same store via the same hooks:

| Tier | Surface | Subscribes to |
|---|---|---|
| Per-conversation | Sidebar entry dot in `conversation-item.tsx` | `useIsStreaming(id)`, `useHasUnseenCompletion(id)` |
| Workspace-aggregate | Footer text in `conversation-sidebar.tsx` | `useActiveStreamCount(teamId)` |
| Global / off-chat | Chat icon dot in `app-sidebar.tsx` | `useActiveStreamCount(teamId)`, `useHasAnyUnseenCompletion(teamId)` |

Same lifecycle (always-set + consumer-clears established in Part 4), same
brand-accent token, same a11y pattern (decorative dot + cohesive label on
the parent interactive element). A user is never unaware that streams are
running or that responses are pending — regardless of which page they're on.
```

**Verify:**

- Section renders cleanly in any markdown viewer; tables align; code blocks render.
- Every claim in the section can be traced to a specific file and line in the codebase (audit-time spot check).
- Section length is ~120–150 lines — concise enough to read end-to-end, detailed enough to be the canonical reference.

**Forward compatibility:** This section becomes the **canonical reference** for the streaming context. Future PRDs that touch chat (e.g., backlog items: cancel-all from global surface, push notifications, server-side resume) reference this section as their starting point. Future cleanups (e.g., extracting a shared `<StreamingDot />` component if a 4th surface lands) update only the indicator-system table.

---

### Increment 2 — Key Design Decisions entry

**What:** Add a new numbered entry to the existing Key Design Decisions list in `ARCHITECTURE.md` documenting the streaming-context architectural choice.

**Files changed:**

| File | Action |
|------|--------|
| `ARCHITECTURE.md` | **Modify** — add a new entry to the Key Design Decisions list |

**Entry content (proposed):**

```markdown
N. **Streaming context as a module-level singleton** (PRD-024).
The chat-streaming subsystem lives at module scope (`lib/streaming/`) —
not React Context, not Redux, not Zustand. Three reasons:
- **Cross-page survival.** State persists across React tree changes (e.g.,
  `/chat` → `/dashboard`). Module-level data lives as long as the JS bundle;
  navigation can't tear it down. No state-persistence layer required.
- **Selective re-rendering.** Plain React Context broadcasts to every consumer
  on every change — defeating per-conversation subscribers in the sidebar.
  `useSyncExternalStore` over a custom Map+listeners store gives selector-
  based subscriptions with primitive snapshots; subscribers to conversation A
  bail out of re-renders on deltas in conversation B.
- **No external state library.** CLAUDE.md mandates "React hooks only." The
  custom store is ~140 LOC; `useSyncExternalStore` is React 18 native. Same
  primitive Zustand and Jotai use internally, scoped to one feature.

Per-conversation slices (keyed by conversationId, scoped by teamId) enable
multi-stream concurrency as a structural property — cancelling stream A
doesn't affect stream B because each has its own slice + AbortController.
The pre-PRD UI-bleed bug (streaming-bubble rendering against the wrong
conversation) is structurally impossible: the chat-area reads its own
conversation's slice, and switching conversations switches which slice
is read.

The concurrency cap is **5 per workspace** (`MAX_CONCURRENT_STREAMS`).
Pinned high enough that real users won't hit it; low enough to prevent
abuse and ensure resource limits stay reasonable. Enforced at the UI
layer (chat-area + chat-input) AND defensively in `startStream` itself.
```

**Verify:**

- Entry numbering matches the existing list (insert at the next available number).
- Cross-references match other entries' tone and detail level.
- The decision text is **declarative** (states the choice), not aspirational (states the goal).

**Forward compatibility:** Future architectural changes that propose deviating from this pattern (e.g., "let's add a Provider", "let's persist to localStorage") will read this entry first and have to either justify the deviation or align with the established design.

---

### Increment 3 — File-map walk + CHANGELOG verification + PRD-023 P4 reconciliation

**What:** Triple verification pass:

1. **File-map walk** (P7.R2). Walk `ARCHITECTURE.md`'s file map against the actual filesystem. Add any files introduced by Parts 1–6 that aren't yet listed. Remove any entries for files that no longer exist. Goal: `git diff` between the file map and a freshly-generated tree listing produces zero diffs.

2. **CHANGELOG verification** (P7.R4). Confirm every Part 1–6 has a dated entry in `CHANGELOG.md`. Verify dates are present, wording is consistent, and net-code-change accounting matches the actual diffs.

3. **PRD-023 P4 reconciliation** (P7.R5). Repo-wide grep for "PRD-023 P4" / "PRD-023 Part 4" references. Update PRD-023's deferred-Part-4 block to point at the specific PRD-024 parts that delivered the work (P2 = bleed-bug fix + useChat migration; P6 = under-200-LOC + SSE-utility consolidation). Remove any code-level references; doc-level references that document the deferral history can stay if they reference the resolution.

**Files changed:**

| File | Action |
|------|--------|
| `ARCHITECTURE.md` | **Modify** — file-map walk fixes; mostly verifications, may produce small additions/removals |
| `CHANGELOG.md` | **Modify** — wording polish if any inconsistencies surface; no new entries (Parts 1–6 entries already exist) |
| `docs/023-codebase-cleanup/prd.md` | **Modify** — deferred-Part-4 block points at PRD-024 P2 + P6 |
| `docs/023-codebase-cleanup/trd.md` | **Modify** (if exists, if it references P4 specifically) — same pointer update |
| Any code file with `// PRD-023 P4` style comments | **Modify** — update or remove |

**Implementation steps:**

1. **Generate the actual filesystem tree** for the relevant directories:

   ```bash
   find app components lib -type f -name "*.ts" -o -name "*.tsx" \
     | grep -v "node_modules" | sort
   ```

   Compare against the file map in `ARCHITECTURE.md`. For each file in the tree, verify there's an entry; for each entry, verify the file exists.

2. **CHANGELOG cross-check.** `grep -c "^### PRD-024 Part" CHANGELOG.md` should return **6**. Open each entry, verify the date, the wording, and that the net-code-change accounting roughly matches what shipped.

3. **PRD-023 P4 grep:**

   ```bash
   grep -rn "PRD-023 P4\|PRD-023 Part 4" \
     app components lib docs 2>&1 \
     | grep -v "node_modules"
   ```

   For each hit:
   - Code-level reference → remove or update.
   - Doc-level reference in PRD-023 (the deferral block) → update to point at the delivering PRD-024 parts.
   - Doc-level reference in PRD-024 (linkback) → keep as historical context.

**Verify:**

- File-map walk produces zero diffs against the filesystem (manual `diff` between map listing and `find` output).
- `grep -c "^### PRD-024 Part" CHANGELOG.md` returns **6**.
- `grep -rn "PRD-023 P4" lib app components` returns no code-level hits.
- PRD-023's deferral block references PRD-024 P2 + P6 (the parts that delivered).

**Forward compatibility:** A future engineer searching for "PRD-023 P4" finds the deferral block in PRD-023 with a clear pointer to where the work landed. No breadcrumb leads to nothing.

---

### Increment 4 — End-of-PRD audit (CLAUDE.md prescribed)

**What:** The cumulative audit pass that runs after the final part of every PRD. Per CLAUDE.md "End-of-PRD audit":

> 1. Run the full end-of-part audit checklist (above) across all files touched by the PRD
> 2. Verify ARCHITECTURE.md file map is complete and accurate
> 3. Verify CHANGELOG.md has entries for every completed part
> 4. Run `npx tsc --noEmit` for a final type check
> 5. This audit produces fixes and documentation updates, not a report

**What I run:**

1. **The end-of-part audit checklist** (SRP, DRY, design tokens, logging, dead code, convention) **across the entire surface touched by Parts 1–6**:
   - `lib/streaming/` (5 files)
   - `lib/hooks/use-chat.ts` + `use-conversation-messages.ts` + `use-chat-streaming.ts`
   - `lib/utils/chat-helpers.ts`
   - `app/chat/_components/chat-area.tsx`, `chat-input.tsx`, `chat-page-content.tsx`, `conversation-item.tsx`, `conversation-sidebar.tsx`
   - `components/layout/app-sidebar.tsx`
   - `components/providers/auth-provider.tsx`

   Cumulative re-audit catches issues that emerged from later parts touching earlier files (e.g., did Part 5's auth-state change break a Part 1 invariant? Did Part 6's decomposition leave a stale reference in Part 4's conversation-item subscription? etc.).

2. **File map vs. filesystem** — done as part of Increment 3; re-verified here.

3. **CHANGELOG entries for every completed part** — done as part of Increment 3; re-verified here.

4. **`npx tsc --noEmit`** — final type check across the entire codebase.

5. **Smoke test** — run the cumulative manual battery (every P1–P6 acceptance criterion) one final time. By Part 7 each part's gate has been run individually; the cumulative run is the final shipping gate.

**Files changed:** Audit may produce code or documentation fixes anywhere in the codebase. No predicted file list — depends on what the audit finds.

**Verify:**

- `npx tsc --noEmit` passes clean.
- All P1–P6 acceptance criteria still pass.
- File map and CHANGELOG are complete and accurate.
- No stale `PRD-023 P4` references in code.
- Streaming-context section + Key Design Decisions entry are present and accurate.

**Forward compatibility:** PRD-024 is now a closed, canonical implementation. Future chat-related PRDs reference its design via the `ARCHITECTURE.md` streaming-context section. The PRD-023 P4 carry-over is fully closed.

### After Part 7 completes

PRD-024 ships. Per CLAUDE.md, no further per-part documentation updates are owed (Part 7 IS the documentation increment).

1. **No further `ARCHITECTURE.md` updates** — this part wrote them.
2. **No further `CHANGELOG.md` entries** — Part 7 itself can land a brief one-line entry summarizing the PRD's closure (e.g., *"PRD-024 complete: multi-stream chat shipped end-to-end with streaming context, indicator system, and decomposed `useChat`"*) but most of the value is in the per-part entries already present.
3. **No DB schema change.**
4. **PRD-024 is closed.** The Backlog section of the PRD (cancel-all from global surface, toast notifications, server-side resume on reload, mobile-tailored UX, per-conversation cooldown) remains explicitly out of scope for follow-up work.

---
