"use client";

// ---------------------------------------------------------------------------
// useChat — Conversation-scoped chat orchestrator (PRD-024 Part 2)
// ---------------------------------------------------------------------------
// Owns the active conversation's message list (load, paginate, fold-on-
// completion, clear, not-found). Streaming state, the SSE loop, abort
// handling, and the cancelled-bubble construction all live in
// `lib/streaming/`. This hook subscribes to the slice for the active
// conversation and folds the slice's `finalMessage` into `messages[]` via
// useLayoutEffect — synchronous before paint to satisfy P2.R7's no-flicker
// guarantee.
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
  markFinalMessageConsumed,
  startStream as moduleStartStream,
  useStreamingSlice,
} from "@/lib/streaming";

import type { ChatSource, Message, StreamState } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[useChat]";
const MESSAGES_PAGE_SIZE = 20;

// Stable empty-array reference so the `latestFollowUps` passthrough doesn't
// produce a fresh array on every render when no slice exists.
const EMPTY_FOLLOW_UPS: string[] = [];

interface UseChatOptions {
  /**
   * Active conversation UUID. `null` means fresh chat — no DB row yet,
   * URL is `/chat`, sidebar has no entry for this session. The UUID
   * materialises on first send: `sendMessage` generates one with
   * `crypto.randomUUID()` for the POST and notifies the parent via
   * `onConversationCreated` once the server confirms via response
   * header. (Gap P9)
   */
  conversationId: string | null;
  /**
   * Active workspace — NULL = personal. Threaded into the streaming
   * module so each slice carries its workspace tag for Part 5's
   * cross-workspace isolation. (PRD-024 P5.R5)
   */
  teamId: string | null;
  /**
   * Fires exactly once per fresh-chat send, right after the server
   * responds with `X-Conversation-Id` confirming the new conversation
   * row exists. Parent uses this to prepend the entry to the sidebar
   * and silently update the URL via history API.
   */
  onConversationCreated?: (id: string) => void;
  onTitleGenerated?: (id: string, title: string) => void;
}

interface UseChatReturn {
  /** Send a message. If conversationId is null, creates a new conversation. */
  sendMessage: (content: string) => Promise<void>;
  /** Cancel the in-progress stream. */
  cancelStream: () => void;
  /** Retry the latest failed/stale assistant message. */
  retryLastMessage: () => Promise<void>;
  /** Current streaming state. */
  streamState: StreamState;
  /** Streaming content being accumulated (empty when idle). */
  streamingContent: string;
  /** Ephemeral status text from tool execution ("Searching...", etc.). */
  statusText: string | null;
  /** Sources from the latest completed stream (cleared on new send). */
  latestSources: ChatSource[] | null;
  /** Follow-up questions from the latest completed stream. */
  latestFollowUps: string[];
  /** Error message if streamState is "error". */
  error: string | null;
  /** Messages for the active conversation. */
  messages: Message[];
  /** Whether messages are loading. */
  isLoadingMessages: boolean;
  /** Whether more messages can be loaded (infinite scroll up). */
  hasMoreMessages: boolean;
  /** Fetch older messages for infinite scroll. */
  fetchMoreMessages: () => Promise<void>;
  /**
   * Synchronously clear messages + pagination state. Used by the parent
   * around in-app navigation (sidebar click, "New chat", popstate) so the
   * `setActiveConversationId(...)` call in the same handler batches with
   * the message clear into one React render commit — no flash of the
   * previous conversation's messages while the new one loads.
   */
  clearMessages: () => void;
  /**
   * True when the messages-list fetch returned 404 — the conversation
   * doesn't exist or is inaccessible (cross-user UUID hidden by RLS).
   * UI surfaces a "Conversation not found" state with a CTA back to
   * `/chat`. Resets to false on every load attempt, on null transitions,
   * and on `clearMessages()`.
   */
  isConversationNotFound: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChat(options: UseChatOptions): UseChatReturn {
  // Note: onTitleGenerated is accepted for forward compatibility but not yet
  // wired — titles arrive via fire-and-forget server generation and the client
  // discovers them through conversation list refetch in useConversations.
  const { conversationId, teamId, onConversationCreated } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isConversationNotFound, setIsConversationNotFound] = useState(false);

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

  // Streaming state — derived from the slice. Switching conversations
  // switches which slice is read, which structurally fixes the pre-PRD
  // UI-bleed bug (PRD-024 P2.R4).
  const streamState: StreamState = slice?.streamState ?? "idle";
  const streamingContent = slice?.streamingContent ?? "";
  const statusText = slice?.statusText ?? null;
  const latestSources = slice?.latestSources ?? null;
  const latestFollowUps = slice?.latestFollowUps ?? EMPTY_FOLLOW_UPS;
  const error = slice?.error ?? null;

  // Stable refs for callbacks and the load-messages skip-refetch guard.
  const conversationIdRef = useRef<string | null>(conversationId);
  // Mirrors `subscriptionId` so cancelStream can resolve the effective
  // streaming target (prop, or fresh-send fallback) without recomputing
  // the priority chain inline. One ref, one concept.
  const subscriptionIdRef = useRef<string | null>(null);
  const onConversationCreatedRef = useRef(onConversationCreated);
  // Mirrors `messages.length` so the load-messages effect can detect
  // "we already have messages from streaming" without depending on
  // `messages` (which would re-run on every fold).
  const messagesRef = useRef(messages);
  // Tracks the conversationId from the previous render so the load-messages
  // effect can distinguish `null → just-created via send` (skip refetch —
  // the optimistic user message is already present) from genuine
  // conversation switches.
  const prevConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    subscriptionIdRef.current = subscriptionId;
  }, [subscriptionId]);

  useEffect(() => {
    onConversationCreatedRef.current = onConversationCreated;
  }, [onConversationCreated]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Clear the fresh-send fallback once the parent confirms by setting
  // conversationId. After this point, the prop carries the uuid and
  // pendingConversationId is no longer needed.
  useEffect(() => {
    if (conversationId !== null && pendingConversationId !== null) {
      setPendingConversationId(null);
    }
  }, [conversationId, pendingConversationId]);

  // -------------------------------------------------------------------------
  // Load messages when conversation changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    const prev = prevConversationIdRef.current;
    prevConversationIdRef.current = conversationId;

    // Fresh chat — no DB row yet. Clear any prior conversation's messages
    // and skip the fetch (it would 404).
    if (conversationId === null) {
      setMessages([]);
      setHasMoreMessages(false);
      setIsConversationNotFound(false);
      return;
    }

    // null → just-created via first-send: useChat already populated
    // `messages` with the optimistic user message and the streaming module
    // is mid-stream. Refetching here would clobber the optimistic message.
    // Skip exactly this transition.
    if (prev === null && messagesRef.current.length > 0) {
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      setIsLoadingMessages(true);
      setMessages([]);
      setIsConversationNotFound(false);

      try {
        console.log(
          `${LOG_PREFIX} loading messages for conversation: ${conversationId}`
        );
        const res = await fetch(
          `/api/chat/conversations/${conversationId}/messages?limit=${MESSAGES_PAGE_SIZE}`
        );

        if (res.status === 404) {
          if (!cancelled) {
            console.log(
              `${LOG_PREFIX} conversation not found: ${conversationId}`
            );
            setIsConversationNotFound(true);
            setHasMoreMessages(false);
          }
          return;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        if (!cancelled) {
          setMessages(data.messages);
          setHasMoreMessages(data.hasMore);
          console.log(
            `${LOG_PREFIX} loaded ${data.messages.length} messages, hasMore: ${data.hasMore}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`${LOG_PREFIX} failed to load messages: ${msg}`);
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    }

    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // -------------------------------------------------------------------------
  // Fold finalMessage into messages[] before paint (P2.R7)
  // -------------------------------------------------------------------------
  //
  // useLayoutEffect runs synchronously after DOM mutations but before paint.
  // When the slice transitions streaming→idle with finalMessage set, this
  // appends the message and acknowledges consumption (clearing finalMessage)
  // in the same render cycle — so the user never sees a frame where the
  // streaming bubble has vanished but the completed message hasn't appeared.

  useLayoutEffect(() => {
    if (!slice?.finalMessage) return;
    const completed = slice.finalMessage;
    setMessages((prev) => [...prev, completed]);
    markFinalMessageConsumed(slice.conversationId);
    console.log(
      `${LOG_PREFIX} folded finalMessage conversation=${slice.conversationId} messageId=${completed.id} status=${completed.status}`
    );
  }, [slice?.finalMessage, slice?.conversationId]);

  // -------------------------------------------------------------------------
  // Fetch more messages (infinite scroll upward)
  // -------------------------------------------------------------------------

  const fetchMoreMessages = useCallback(async () => {
    if (!conversationId || messages.length === 0) return;

    const oldestMessage = messages[0];
    const cursor = oldestMessage.createdAt;

    try {
      console.log(`${LOG_PREFIX} fetching more messages, cursor: ${cursor}`);
      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages?limit=${MESSAGES_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      setMessages((prev) => [...data.messages, ...prev]);
      setHasMoreMessages(data.hasMore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`${LOG_PREFIX} fetchMoreMessages failed: ${msg}`);
    }
  }, [conversationId, messages]);

  // -------------------------------------------------------------------------
  // Send message — delegates SSE to the streaming module
  // -------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (content: string) => {
      console.log(
        `${LOG_PREFIX} sendMessage — content length: ${content.length}`
      );

      // Client-owned UUID for the user message. Same ID used for the
      // optimistic bubble and the POST body; no temp-ID swap needed.
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
    [teamId]
  );

  // -------------------------------------------------------------------------
  // Cancel stream — delegates to the module
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
  // Retry last message
  // -------------------------------------------------------------------------

  const retryLastMessage = useCallback(async () => {
    console.log(`${LOG_PREFIX} retryLastMessage`);

    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");

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
  }, [messages, sendMessage]);

  // -------------------------------------------------------------------------
  // Clear messages — used around in-app navigation so the parent's
  // setActiveConversationId(...) and our setMessages([]) batch into one
  // React render commit. Stable identity via useCallback with empty deps.
  // -------------------------------------------------------------------------

  const clearMessages = useCallback(() => {
    setMessages([]);
    setHasMoreMessages(false);
    setIsConversationNotFound(false);
  }, []);

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
    messages,
    isLoadingMessages,
    hasMoreMessages,
    fetchMoreMessages,
    clearMessages,
    isConversationNotFound,
  };
}
