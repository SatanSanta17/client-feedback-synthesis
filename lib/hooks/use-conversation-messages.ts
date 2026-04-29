"use client";

// ---------------------------------------------------------------------------
// useConversationMessages — Message-list management (PRD-024 Part 6)
// ---------------------------------------------------------------------------
// Internal building block for useChat. Owns the active conversation's
// messages array, pagination state, loading state, and the not-found state.
// Includes the Gap P9 skip-refetch guard for the fresh-send → confirmed
// conversation transition.
//
// Not re-exported from any barrel — useChat is the public composer.
// Consumed by useChat and useChatStreaming (the latter via setMessages
// threading for optimistic adds, retry trim, and fold-on-completion).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

import type { Message } from "@/lib/types/chat";

const LOG_PREFIX = "[useChat]";
const MESSAGES_PAGE_SIZE = 20;

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
  /**
   * Internal: exposed so useChatStreaming can perform optimistic adds
   * (sendMessage), trim (retryLastMessage), and fold completions (the
   * useLayoutEffect). Not part of the composer's public UseChatReturn —
   * useChat does not pass this through to chat-surface components.
   */
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export function useConversationMessages(
  options: UseConversationMessagesOptions
): UseConversationMessagesReturn {
  const { conversationId } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isConversationNotFound, setIsConversationNotFound] = useState(false);

  // Mirrors `messages.length` so the load-messages effect can detect "we
  // already have messages from streaming" without depending on `messages`
  // (which would re-run on every fold).
  const messagesRef = useRef(messages);

  // Tracks the conversationId from the previous render so the load-messages
  // effect can distinguish `null → just-created via send` (skip refetch —
  // the optimistic user message is already present) from genuine
  // conversation switches.
  const prevConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

    // null → just-created via first-send: useChatStreaming already populated
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
    messages,
    isLoadingMessages,
    hasMoreMessages,
    isConversationNotFound,
    fetchMoreMessages,
    clearMessages,
    setMessages,
  };
}
