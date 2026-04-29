"use client";

// ---------------------------------------------------------------------------
// useChat — Composer for message-list and streaming sub-hooks (PRD-024 Part 6)
// ---------------------------------------------------------------------------
// Pure composition layer: instantiates `useConversationMessages` (Part 6) and
// `useChatStreaming` (Part 6), wires the message-list seam (setMessages +
// messages threaded through), and returns the combined UseChatReturn shape
// that chat-surface components consume unchanged. All actual logic lives in
// the two sub-hooks. This composer exists to preserve the existing
// UseChatOptions / UseChatReturn contract — chat-area, chat-input,
// message-thread, etc. compile and run with no changes (P2.R5).
// ---------------------------------------------------------------------------

import { useChatStreaming } from "./use-chat-streaming";
import { useConversationMessages } from "./use-conversation-messages";

import type { ChatSource, Message, StreamState } from "@/lib/types/chat";

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

export function useChat(options: UseChatOptions): UseChatReturn {
  // Note: onTitleGenerated is accepted for forward compatibility but not
  // yet wired — titles arrive via fire-and-forget server generation and
  // the client discovers them through the conversations list refetch in
  // useConversations.

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
    // Message-list passthrough
    messages: messageList.messages,
    isLoadingMessages: messageList.isLoadingMessages,
    hasMoreMessages: messageList.hasMoreMessages,
    fetchMoreMessages: messageList.fetchMoreMessages,
    clearMessages: messageList.clearMessages,
    isConversationNotFound: messageList.isConversationNotFound,
  };
}
