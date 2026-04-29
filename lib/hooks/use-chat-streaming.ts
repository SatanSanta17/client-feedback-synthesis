"use client";

// ---------------------------------------------------------------------------
// useChatStreaming — Streaming subscription + delegates (PRD-024 Part 6)
// ---------------------------------------------------------------------------
// Internal building block for useChat. Subscribes to the streaming module's
// slice for the active conversation, exposes streaming-passthrough fields,
// and provides sendMessage / cancelStream / retryLastMessage that delegate
// to lib/streaming. Wires the message-list seam: receives messages +
// setMessages from useConversationMessages so it can perform optimistic
// adds, retry trims, and fold completions.
//
// Not re-exported from any barrel — useChat is the public composer.
// ---------------------------------------------------------------------------

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  cancelStream as moduleCancelStream,
  markConversationViewed,
  markFinalMessageConsumed,
  startStream as moduleStartStream,
  useStreamingSlice,
} from "@/lib/streaming";

import type { ChatSource, Message, StreamState } from "@/lib/types/chat";

const LOG_PREFIX = "[useChat]";

// Stable empty-array reference so the `latestFollowUps` passthrough doesn't
// produce a fresh array on every render when no slice exists.
const EMPTY_FOLLOW_UPS: string[] = [];

interface UseChatStreamingOptions {
  conversationId: string | null;
  teamId: string | null;
  onConversationCreated?: (id: string) => void;
  /** Wired in from useConversationMessages — needed for optimistic adds
   *  (sendMessage), trim (retryLastMessage), and fold (useLayoutEffect). */
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

export function useChatStreaming(
  options: UseChatStreamingOptions
): UseChatStreamingReturn {
  const {
    conversationId,
    teamId,
    onConversationCreated,
    messages,
    setMessages,
  } = options;

  // Fresh-send fallback: between sendMessage running (which generates the
  // uuid synchronously) and the parent's onConversationCreated callback
  // propagating the uuid back through props, conversationId is still null —
  // useStreamingSlice would otherwise return null and the streaming bubble
  // wouldn't appear until the server's response header arrives. This holds
  // the in-flight uuid so the slice subscription kicks in immediately.
  const [pendingConversationId, setPendingConversationId] = useState<
    string | null
  >(null);

  // Effective subscription target: prop wins, fallback to pending.
  const subscriptionId = conversationId ?? pendingConversationId;
  const slice = useStreamingSlice(subscriptionId);

  // Streaming state derived from the slice. Switching conversations switches
  // which slice is read, which structurally fixes the pre-PRD UI-bleed bug
  // (PRD-024 P2.R4).
  const streamState: StreamState = slice?.streamState ?? "idle";
  const streamingContent = slice?.streamingContent ?? "";
  const statusText = slice?.statusText ?? null;
  const latestSources = slice?.latestSources ?? null;
  const latestFollowUps = slice?.latestFollowUps ?? EMPTY_FOLLOW_UPS;
  const error = slice?.error ?? null;

  const conversationIdRef = useRef<string | null>(conversationId);
  // Mirrors `subscriptionId` so cancelStream can resolve the effective
  // streaming target (prop, or fresh-send fallback) without recomputing
  // the priority chain inline. One ref, one concept.
  const subscriptionIdRef = useRef<string | null>(null);
  const onConversationCreatedRef = useRef(onConversationCreated);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    subscriptionIdRef.current = subscriptionId;
  }, [subscriptionId]);

  useEffect(() => {
    onConversationCreatedRef.current = onConversationCreated;
  }, [onConversationCreated]);

  // Clear the fresh-send fallback once the parent confirms by setting
  // conversationId. After this point, the prop carries the uuid and
  // pendingConversationId is no longer needed.
  useEffect(() => {
    if (conversationId !== null && pendingConversationId !== null) {
      setPendingConversationId(null);
    }
  }, [conversationId, pendingConversationId]);

  // -------------------------------------------------------------------------
  // Fold finalMessage into messages[] before paint (PRD-024 P2.R7)
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    if (!slice?.finalMessage) return;
    const completed = slice.finalMessage;
    setMessages((prev) => [...prev, completed]);
    markFinalMessageConsumed(slice.conversationId);
    console.log(
      `${LOG_PREFIX} folded finalMessage conversation=${slice.conversationId} messageId=${completed.id} status=${completed.status}`
    );
  }, [slice?.finalMessage, slice?.conversationId, setMessages]);

  // -------------------------------------------------------------------------
  // Auto-acknowledge unseen-completion while user is viewing (PRD-024 P4.R2)
  // -------------------------------------------------------------------------
  // Invariant: if useChat is mounted on a conversation, that conversation's
  // hasUnseenCompletion should always be cleared — the user IS the viewer.
  // Handles all terminal states uniformly (completion, cancelled-with-content,
  // errored-with-content), including the error case where finalMessage stays
  // null and the fold above wouldn't fire on its own.

  useLayoutEffect(() => {
    if (slice?.hasUnseenCompletion && slice.conversationId) {
      markConversationViewed(slice.conversationId);
    }
  }, [slice?.hasUnseenCompletion, slice?.conversationId]);

  // -------------------------------------------------------------------------
  // sendMessage — delegates SSE to the streaming module
  // -------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (content: string) => {
      console.log(
        `${LOG_PREFIX} sendMessage — content length: ${content.length}`
      );

      // Client-owned UUID for the user message (Gap E14 / P9).
      const userMessageId = crypto.randomUUID();

      // Conversation UUID — generated lazily on first send when there's no
      // active conversation yet (Gap P9). Otherwise reuse the active one.
      const isFreshSend = conversationIdRef.current === null;
      const conversationIdForPost =
        conversationIdRef.current ?? crypto.randomUUID();

      // Optimistic user message — added before the stream kicks off so the
      // load-messages effect's "skip refetch" guard observes a non-empty
      // message list when the conversation id propagates back from the
      // onConversationCreated callback.
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

      // For fresh sends, set the fallback so useStreamingSlice subscribes
      // to the new uuid's slice immediately. Without this, the streaming
      // bubble wouldn't appear until the parent's setActiveConversationId
      // propagates after the server's X-Conversation-Id header arrives.
      if (isFreshSend) {
        setPendingConversationId(conversationIdForPost);
      }

      // Delegate the SSE work to the streaming module. The module owns the
      // fetch, the AbortController, the state machine, and the slice
      // mutations. We re-enter via the useLayoutEffect fold above when the
      // slice's finalMessage transitions from null to a Message.
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
    [teamId, setMessages]
  );

  // -------------------------------------------------------------------------
  // cancelStream — delegates to the module
  // -------------------------------------------------------------------------

  const cancelStream = useCallback(() => {
    console.log(`${LOG_PREFIX} cancelStream`);
    if (subscriptionIdRef.current) {
      moduleCancelStream(subscriptionIdRef.current);
    }
    // The module sets slice.finalMessage to a status:"cancelled" Message;
    // the useLayoutEffect fold appends it to messages[] in the next render.
  }, []);

  // -------------------------------------------------------------------------
  // retryLastMessage — trim + re-send via the local sendMessage
  // -------------------------------------------------------------------------

  const retryLastMessage = useCallback(async () => {
    console.log(`${LOG_PREFIX} retryLastMessage`);

    const lastUserMessage = messages.findLast((m) => m.role === "user");

    if (!lastUserMessage) {
      console.warn(`${LOG_PREFIX} no user message found to retry`);
      return;
    }

    // Strip trailing failed/cancelled/streaming assistant message AND the
    // user message that preceded it (sendMessage will re-add it).
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
  }, [messages, setMessages, sendMessage]);

  return {
    sendMessage,
    cancelStream,
    retryLastMessage,
    streamState,
    streamingContent,
    statusText,
    latestSources,
    latestFollowUps,
    error,
  };
}
