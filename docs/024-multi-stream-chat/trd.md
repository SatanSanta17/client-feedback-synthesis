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
