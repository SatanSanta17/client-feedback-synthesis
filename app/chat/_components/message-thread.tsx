"use client";

// ---------------------------------------------------------------------------
// MessageThread — Virtualized message list (PRD-020 Part 3, Increment 3.3)
// ---------------------------------------------------------------------------
// Uses react-virtuoso in reverse mode for chat-style bottom-anchored scrolling.
// Supports infinite scroll upward to load older messages, and auto-scroll
// when new messages arrive (disabled when user scrolls up).
// ---------------------------------------------------------------------------

import { useRef, useCallback, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { MessageBubble } from "./message-bubble";
import type { Message } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Virtual index offset — starts high so prepended items get lower indices. */
const FIRST_ITEM_INDEX_BASE = 100_000;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageThreadProps {
  messages: Message[];
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  onFetchMoreMessages: () => Promise<void>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessageThread({
  messages,
  isLoadingMessages,
  hasMoreMessages,
  onFetchMoreMessages,
  className,
}: MessageThreadProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  // firstItemIndex shifts as we prepend older messages
  const firstItemIndex = FIRST_ITEM_INDEX_BASE - messages.length;

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

  // Render a single message item
  const renderItem = useCallback(
    (virtualIndex: number, message: Message) => {
      // Convert virtual index to real array index (O(1) instead of indexOf)
      const realIndex = virtualIndex - (FIRST_ITEM_INDEX_BASE - messages.length);
      const isLatest = realIndex === messages.length - 1;
      const canRetry =
        isLatest &&
        message.role === "assistant" &&
        (message.status === "failed" ||
          message.status === "cancelled" ||
          message.status === "streaming");

      return (
        <MessageBubble
          message={message}
          isLatest={isLatest}
          canRetry={canRetry}
        />
      );
    },
    [messages]
  );

  if (isLoadingMessages) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
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

  if (messages.length === 0) {
    return null; // Empty state handled by ChatArea
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      className={className}
      data={messages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={messages.length - 1}
      itemContent={renderItem}
      startReached={handleStartReached}
      atBottomStateChange={handleAtBottomStateChange}
      followOutput={isAtBottom ? "smooth" : false}
      overscan={200}
      increaseViewportBy={{ top: 400, bottom: 200 }}
      components={{
        Header: () =>
          isFetchingMore ? (
            <div className="flex justify-center py-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          ) : null,
      }}
    />
  );
}
