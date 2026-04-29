// ---------------------------------------------------------------------------
// Streaming Actions — imperative API for the streaming module (PRD-024)
// ---------------------------------------------------------------------------
// Owns the SSE loop. Writes to the store via setSlice; never mutates message
// lists (that's useChat's job in Part 2 — it reads slice.finalMessage on the
// streaming→idle transition and folds it into messages[]).
// ---------------------------------------------------------------------------

import {
  parseFollowUps,
  parseSSEChunk,
  stripFollowUpBlock,
} from "@/lib/utils/chat-helpers";
import type { ChatSource, Message } from "@/lib/types/chat";

import {
  setSlice,
  getSlice,
  setAbortController,
  getAbortController,
  deleteAbortController,
  clearAll,
} from "./streaming-store";
import { IDLE_SLICE_DEFAULTS, type StartStreamArgs } from "./streaming-types";

const LOG_PREFIX = "[streaming]";

// ---------------------------------------------------------------------------
// startStream — kick off an SSE stream for a conversation
// ---------------------------------------------------------------------------

export function startStream(args: StartStreamArgs): void {
  const { conversationId, teamId } = args;
  console.log(
    `${LOG_PREFIX} startStream conversation=${conversationId} team=${teamId ?? "personal"}`
  );

  // Seed the slice as streaming. Subscribers (chat-area, sidebar dots) light up immediately.
  setSlice(conversationId, {
    ...IDLE_SLICE_DEFAULTS,
    conversationId,
    teamId,
    streamState: "streaming",
    startedAt: Date.now(),
  });

  const controller = new AbortController();
  setAbortController(conversationId, controller);

  // SSE loop runs detached — the caller doesn't await. Errors are written to
  // the slice; abort is the only non-error termination and is handled inline.
  void runStream({ ...args, signal: controller.signal })
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Cancellation already wrote the cancelled bubble in cancelStream().
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `${LOG_PREFIX} stream failed conversation=${conversationId}: ${message}`
      );
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

interface RunStreamArgs extends StartStreamArgs {
  signal: AbortSignal;
}

async function runStream(args: RunStreamArgs): Promise<void> {
  const {
    conversationId,
    userMessage,
    userMessageId,
    signal,
    onConversationCreated,
  } = args;

  const res = await fetch("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId,
      userMessageId,
      message: userMessage,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ message: "Unknown error" }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  const headerAssistantId = res.headers.get("X-Assistant-Message-Id");
  if (headerAssistantId) {
    setSlice(conversationId, {
      conversationId,
      assistantMessageId: headerAssistantId,
    });
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
        console.warn(
          `${LOG_PREFIX} failed to parse SSE event data: ${sseEvent.event}`
        );
        continue;
      }

      switch (sseEvent.event) {
        case "status":
          setSlice(conversationId, {
            conversationId,
            statusText: (data.text as string) ?? null,
          });
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
          setSlice(conversationId, {
            conversationId,
            latestSources: accumulatedSources,
          });
          break;
        case "follow_ups":
          accumulatedFollowUps = (data.questions as string[]) ?? [];
          setSlice(conversationId, {
            conversationId,
            latestFollowUps: accumulatedFollowUps,
          });
          break;
        case "done":
          // No-op — final-message construction happens after loop exit so the
          // streamState→idle flip and finalMessage land in one setSlice call.
          break;
        case "error":
          throw new Error((data.message as string) ?? "Stream error");
      }
    }
  }

  // Stream completed cleanly. Hand the final message to the slice in the SAME
  // setSlice call that flips streamState to 'idle' — subscribers see the
  // transition + finalMessage atomically. This is the mechanism behind
  // P2.R7's no-flicker guarantee.
  const { cleanContent } = parseFollowUps(accumulatedContent);
  const sliceNow = getSlice(conversationId);
  const assistantId =
    sliceNow?.assistantMessageId ?? `temp-assistant-${Date.now()}`;

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

  // hasUnseenCompletion is left false here; Part 4's selection logic decides
  // whether to flip it based on whether a chat-area is currently subscribed
  // to this conversation.
  setSlice(conversationId, {
    conversationId,
    streamState: "idle",
    streamingContent: "",
    statusText: null,
    finalMessage,
    latestFollowUps: accumulatedFollowUps,
  });

  console.log(
    `${LOG_PREFIX} stream completed conversation=${conversationId} messageId=${assistantId}`
  );
}

// ---------------------------------------------------------------------------
// cancelStream — abort and preserve partial content (Gap E14 parity)
// ---------------------------------------------------------------------------

export function cancelStream(conversationId: string): void {
  const controller = getAbortController(conversationId);
  if (!controller) {
    console.log(
      `${LOG_PREFIX} cancelStream no-op conversation=${conversationId} (no active controller)`
    );
    return;
  }
  console.log(`${LOG_PREFIX} cancelStream conversation=${conversationId}`);

  controller.abort();
  deleteAbortController(conversationId);

  const slice = getSlice(conversationId);
  const partialContent = slice?.streamingContent ?? "";
  const assistantId =
    slice?.assistantMessageId ?? `temp-cancelled-${Date.now()}`;

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

// ---------------------------------------------------------------------------
// markConversationViewed — clear the unseen-completion flag (Part 4 R6)
// ---------------------------------------------------------------------------

export function markConversationViewed(conversationId: string): void {
  const slice = getSlice(conversationId);
  if (!slice || !slice.hasUnseenCompletion) return;
  setSlice(conversationId, { conversationId, hasUnseenCompletion: false });
}

// ---------------------------------------------------------------------------
// clearAllStreams — sign-out teardown (Part 5 R4)
// ---------------------------------------------------------------------------

export function clearAllStreams(): void {
  console.log(`${LOG_PREFIX} clearAllStreams — tearing down all slices`);
  clearAll();
}
