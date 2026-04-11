"use client";

// ---------------------------------------------------------------------------
// useChat — Custom SSE streaming hook (PRD-020 Part 3)
// ---------------------------------------------------------------------------
// Manages the SSE connection to /api/chat/send, streaming state machine,
// AbortController for cancellation, and message list for the active
// conversation. Does NOT use Vercel AI SDK's useChat — custom SSE protocol.
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef, useEffect } from "react";

import { parseFollowUps } from "@/lib/utils/chat-helpers";
import type { ChatSource, Message, StreamState } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[useChat]";
const MESSAGES_PAGE_SIZE = 50;

/**
 * Strip a complete `<!--follow-ups:...-->` block OR a trailing partial one
 * (e.g. `<!--follow-ups:["What are cli`) from streaming content so
 * follow-up metadata never flashes in the message bubble.
 */
const FOLLOW_UP_COMPLETE_RE = /<!--follow-ups:(\[[\s\S]*?\])-->/;
const FOLLOW_UP_PARTIAL_RE = /<!--follow-ups:[\s\S]*$/;

function stripFollowUpBlock(text: string): string {
  // First try complete match
  const complete = text.replace(FOLLOW_UP_COMPLETE_RE, "").trimEnd();
  if (complete !== text) return complete;
  // Then try partial trailing match
  return text.replace(FOLLOW_UP_PARTIAL_RE, "").trimEnd();
}

interface UseChatOptions {
  conversationId: string | null;
  teamId: string | null;
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
}

// ---------------------------------------------------------------------------
// SSE event parsing
// ---------------------------------------------------------------------------

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parse SSE text chunks into typed events.
 * Handles partial chunks by maintaining a buffer.
 */
function parseSSEChunk(buffer: string): { events: SSEEvent[]; remaining: string } {
  const events: SSEEvent[] = [];
  const lines = buffer.split("\n");
  let currentEvent = "";
  let currentData = "";
  let remaining = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7);
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    } else if (line === "" && currentEvent && currentData) {
      events.push({ event: currentEvent, data: currentData });
      currentEvent = "";
      currentData = "";
    } else if (line === "" && !currentEvent && !currentData) {
      // Empty line between events — skip
    } else {
      // Incomplete chunk — keep as remaining
      remaining = lines.slice(i).join("\n");
      break;
    }
  }

  // If we have partial event data at the end, keep it
  if (currentEvent || currentData) {
    const partial = [];
    if (currentEvent) partial.push(`event: ${currentEvent}`);
    if (currentData) partial.push(`data: ${currentData}`);
    remaining = partial.join("\n") + (remaining ? "\n" + remaining : "");
  }

  return { events, remaining };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChat(options: UseChatOptions): UseChatReturn {
  // Note: onTitleGenerated is accepted for forward compatibility but not yet
  // wired — titles arrive via fire-and-forget server generation and the client
  // discovers them through conversation list refetch in useConversations.
  const { conversationId, teamId, onConversationCreated } = options;

  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);

  // Streaming state machine
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [streamingContent, setStreamingContent] = useState("");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [latestSources, setLatestSources] = useState<ChatSource[] | null>(
    null
  );
  const [latestFollowUps, setLatestFollowUps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs for cancellation and stable callbacks
  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef(conversationId);
  const onConversationCreatedRef = useRef(onConversationCreated);
  const streamingContentRef = useRef(streamingContent);

  // Keep refs in sync
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    onConversationCreatedRef.current = onConversationCreated;
  }, [onConversationCreated]);

  useEffect(() => {
    streamingContentRef.current = streamingContent;
  }, [streamingContent]);

  // -------------------------------------------------------------------------
  // Load messages when conversation changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setHasMoreMessages(false);
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      setIsLoadingMessages(true);
      setMessages([]);

      try {
        console.log(
          `${LOG_PREFIX} loading messages for conversation: ${conversationId}`
        );
        const res = await fetch(
          `/api/chat/conversations/${conversationId}/messages?limit=${MESSAGES_PAGE_SIZE}`
        );

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
  // Fetch more messages (infinite scroll upward)
  // -------------------------------------------------------------------------

  const fetchMoreMessages = useCallback(async () => {
    if (!conversationId || messages.length === 0) return;

    // The oldest message is the first in the chronological list
    const oldestMessage = messages[0];
    const cursor = oldestMessage.createdAt;

    try {
      console.log(`${LOG_PREFIX} fetching more messages, cursor: ${cursor}`);
      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages?limit=${MESSAGES_PAGE_SIZE}&cursor=${cursor}`
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      // Prepend older messages (data.messages is already chronological from API)
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMoreMessages(data.hasMore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`${LOG_PREFIX} fetchMoreMessages failed: ${msg}`);
    }
  }, [conversationId, messages]);

  // -------------------------------------------------------------------------
  // Send message — SSE streaming
  // -------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (content: string) => {
      console.log(`${LOG_PREFIX} sendMessage — content length: ${content.length}`);

      // Reset streaming state
      setStreamState("streaming");
      setStreamingContent("");
      setStatusText(null);
      setLatestSources(null);
      setLatestFollowUps([]);
      setError(null);

      // Optimistically add user message
      const optimisticUserMessage: Message = {
        id: `temp-user-${Date.now()}`,
        conversationId: conversationIdRef.current ?? "",
        parentMessageId: null,
        role: "user",
        content,
        sources: null,
        status: "completed",
        metadata: null,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticUserMessage]);

      // Create AbortController for cancellation
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationIdRef.current,
            message: content,
            teamId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: "Unknown error" }));
          throw new Error(body.message || `HTTP ${res.status}`);
        }

        // Check if a new conversation was created
        const newConversationId = res.headers.get("X-Conversation-Id");
        if (
          newConversationId &&
          !conversationIdRef.current &&
          onConversationCreatedRef.current
        ) {
          onConversationCreatedRef.current(newConversationId);
        }

        // Read SSE stream
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let sseBuffer = "";
        let accumulatedContent = "";
        let accumulatedSources: ChatSource[] | null = null;
        let accumulatedFollowUps: string[] = [];
        let assistantMessageId: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const { events, remaining } = parseSSEChunk(sseBuffer);
          sseBuffer = remaining;

          for (const sseEvent of events) {
            let eventData: Record<string, unknown>;
            try {
              eventData = JSON.parse(sseEvent.data);
            } catch {
              console.warn(
                `${LOG_PREFIX} failed to parse SSE event data: ${sseEvent.event}`
              );
              continue;
            }

            switch (sseEvent.event) {
              case "status":
                setStatusText((eventData.text as string) ?? null);
                break;

              case "delta":
                accumulatedContent += (eventData.text as string) ?? "";
                // Strip complete or partial <!--follow-ups:...--> so it
                // never flashes in the streaming display.
                setStreamingContent(
                  stripFollowUpBlock(accumulatedContent)
                );
                break;

              case "sources":
                accumulatedSources =
                  (eventData.sources as ChatSource[]) ?? null;
                setLatestSources(accumulatedSources);
                break;

              case "follow_ups":
                accumulatedFollowUps =
                  (eventData.questions as string[]) ?? [];
                setLatestFollowUps(accumulatedFollowUps);
                break;

              case "done":
                assistantMessageId =
                  (eventData.messageId as string) ?? null;
                break;

              case "error":
                throw new Error(
                  (eventData.message as string) ?? "Stream error"
                );
            }
          }
        }

        // Stream completed — strip any <!--follow-ups:...--> comment the LLM
        // may have emitted inline so it never appears in the rendered message.
        const { cleanContent } = parseFollowUps(accumulatedContent);

        // Add the final assistant message to the list
        const completedMessage: Message = {
          id: assistantMessageId ?? `temp-assistant-${Date.now()}`,
          conversationId:
            newConversationId ?? conversationIdRef.current ?? "",
          parentMessageId: null,
          role: "assistant",
          content: cleanContent,
          sources: accumulatedSources,
          status: "completed",
          metadata: null,
          createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, completedMessage]);
        setStreamState("idle");
        setStreamingContent("");
        setStatusText(null);

        console.log(`${LOG_PREFIX} stream completed — message: ${completedMessage.id}`);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Cancelled by user — handled in cancelStream
          console.log(`${LOG_PREFIX} stream aborted by user`);
          return;
        }

        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`${LOG_PREFIX} stream error: ${errMsg}`);
        setStreamState("error");
        setError(errMsg);
        setStreamingContent("");
        setStatusText(null);
      } finally {
        abortControllerRef.current = null;
      }
    },
    [teamId]
  );

  // -------------------------------------------------------------------------
  // Cancel stream
  // -------------------------------------------------------------------------

  const cancelStream = useCallback(() => {
    console.log(`${LOG_PREFIX} cancelStream`);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Store partial content as a cancelled message (read from ref to avoid stale closure)
    const partialContent = streamingContentRef.current;
    if (partialContent) {
      const cancelledMessage: Message = {
        id: `temp-cancelled-${Date.now()}`,
        conversationId: conversationIdRef.current ?? "",
        parentMessageId: null,
        role: "assistant",
        content: partialContent,
        sources: null,
        status: "cancelled",
        metadata: null,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, cancelledMessage]);
    }

    setStreamState("idle");
    setStreamingContent("");
    setStatusText(null);
  }, []);

  // -------------------------------------------------------------------------
  // Retry last message
  // -------------------------------------------------------------------------

  const retryLastMessage = useCallback(async () => {
    console.log(`${LOG_PREFIX} retryLastMessage`);

    // Find the last user message to re-send
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");

    if (!lastUserMessage) {
      console.warn(`${LOG_PREFIX} no user message found to retry`);
      return;
    }

    // Remove the failed/cancelled assistant message AND the preceding user message
    // in a single state update to avoid batching issues
    setMessages((prev) => {
      let trimmed = prev;

      // Strip trailing failed/cancelled/stale assistant message
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

      // Strip the user message that preceded it (sendMessage will re-add it)
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

    // Re-send
    await sendMessage(lastUserMessage.content);
  }, [messages, sendMessage]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

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
  };
}
