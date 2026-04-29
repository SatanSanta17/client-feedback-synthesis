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
