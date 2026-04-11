"use client";

// ---------------------------------------------------------------------------
// MessageThread — Virtualized message list (PRD-020 Part 3, Increment 3.3/3.4)
// ---------------------------------------------------------------------------
// Uses react-virtuoso in reverse mode for chat-style bottom-anchored scrolling.
// Supports infinite scroll upward to load older messages, and auto-scroll
// when new messages arrive (disabled when user scrolls up).
// Appends StreamingMessage as the last item during active streaming.
// ---------------------------------------------------------------------------

import { useRef, useCallback, useState, useMemo } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { MessageBubble } from "./message-bubble";
import { StreamingMessage } from "./streaming-message";
import type { Message, StreamState } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Virtual index offset — starts high so prepended items get lower indices. */
const FIRST_ITEM_INDEX_BASE = 100_000;

/** Loading spinner shown at the top of the list during infinite scroll fetch. */
function VirtuosoHeaderSpinner() {
  return (
    <div className="flex justify-center py-3" aria-label="Loading older messages">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageThreadProps {
  messages: Message[];
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  onFetchMoreMessages: () => Promise<void>;
  /** Current streaming state. */
  streamState: StreamState;
  /** Content being accumulated during streaming. */
  streamingContent: string;
  /** Ephemeral status text during streaming. */
  statusText: string | null;
  /** Retry handler for failed/cancelled assistant messages. */
  onRetry: () => void;
  /** Follow-up questions from the latest completed stream. */
  latestFollowUps: string[];
  /** Called when a follow-up chip is clicked — sends it as a new message. */
  onSendFollowUp: (question: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Sentinel item for streaming
// ---------------------------------------------------------------------------

/** A sentinel "message" appended to the data array when streaming is active. */
const STREAMING_SENTINEL_ID = "__streaming__";

interface StreamingSentinel {
  id: typeof STREAMING_SENTINEL_ID;
  __streaming: true;
}

type ThreadItem = Message | StreamingSentinel;

function isStreamingSentinel(item: ThreadItem): item is StreamingSentinel {
  return "id" in item && item.id === STREAMING_SENTINEL_ID;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessageThread({
  messages,
  isLoadingMessages,
  hasMoreMessages,
  onFetchMoreMessages,
  streamState,
  streamingContent,
  statusText,
  onRetry,
  latestFollowUps,
  onSendFollowUp,
  className,
}: MessageThreadProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  // Build the data array: messages + optional streaming sentinel
  const isStreaming = streamState === "streaming";
  const items: ThreadItem[] = useMemo(() => {
    if (isStreaming) {
      return [
        ...messages,
        { id: STREAMING_SENTINEL_ID, __streaming: true } as StreamingSentinel,
      ];
    }
    return messages;
  }, [messages, isStreaming]);

  // firstItemIndex shifts as we prepend older messages
  const firstItemIndex = FIRST_ITEM_INDEX_BASE - items.length;

  // Infinite scroll upward — triggered when reaching the top
  const handleStartReached = useCallback(async () => {
    if (!hasMoreMessages || isFetchingMore) return;

    setIsFetchingMore(true);
    try {
      await onFetchMoreMessages();
    } finally {
      setIsFetchingMore(false);
    }
  }, [hasMoreMessages, isFetchingMore, onFetchMoreMessages]);

  // Track whether user is at the bottom for auto-scroll decisions
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
  }, []);

  // Render a single item
  const renderItem = useCallback(
    (virtualIndex: number, item: ThreadItem) => {
      // Streaming sentinel — render the live streaming message
      if (isStreamingSentinel(item)) {
        return (
          <StreamingMessage
            content={streamingContent}
            statusText={statusText}
          />
        );
      }

      // Regular message
      const realIndex = virtualIndex - (FIRST_ITEM_INDEX_BASE - items.length);
      // isLatest considers only real messages (not streaming sentinel)
      const isLatestMessage = realIndex === messages.length - 1 && !isStreaming;
      const canRetry =
        isLatestMessage &&
        item.role === "assistant" &&
        (item.status === "failed" ||
          item.status === "cancelled" ||
          item.status === "streaming");

      // Show follow-ups only on the latest completed assistant message when not streaming
      const showFollowUps =
        isLatestMessage &&
        !isStreaming &&
        item.role === "assistant" &&
        item.status === "completed";

      return (
        <MessageBubble
          message={item}
          isLatest={isLatestMessage}
          canRetry={canRetry}
          onRetry={canRetry ? onRetry : undefined}
          followUps={showFollowUps ? latestFollowUps : undefined}
          onSendFollowUp={showFollowUps ? onSendFollowUp : undefined}
        />
      );
    },
    [items, messages.length, isStreaming, streamingContent, statusText, onRetry, latestFollowUps, onSendFollowUp]
  );

  if (isLoadingMessages) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4" aria-busy="true" aria-label="Loading messages">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={`h-16 animate-pulse rounded-2xl bg-muted/50 ${
              i % 2 === 0 ? "ml-auto w-3/5" : "mr-auto w-4/5"
            }`}
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return null; // Empty state handled by ChatArea
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      className={className}
      data={items}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={items.length - 1}
      itemContent={renderItem}
      startReached={handleStartReached}
      atBottomStateChange={handleAtBottomStateChange}
      followOutput={isAtBottom ? "smooth" : false}
      overscan={200}
      increaseViewportBy={{ top: 400, bottom: 200 }}
      components={{
        Header: isFetchingMore ? VirtuosoHeaderSpinner : undefined,
      }}
    />
  );
}
