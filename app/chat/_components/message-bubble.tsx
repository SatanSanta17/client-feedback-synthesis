"use client";

// ---------------------------------------------------------------------------
// MessageBubble — Single message rendering (PRD-020 Part 3, Increment 3.3/3.4)
// ---------------------------------------------------------------------------
// User messages: right-aligned, coloured background.
// Assistant messages: left-aligned, neutral background, markdown rendered.
// Shows status indicator for failed/cancelled messages with optional retry.
// ---------------------------------------------------------------------------

import { memo } from "react";

import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "./memoized-markdown";
import { MessageActions } from "./message-actions";
import { MessageStatusIndicator } from "./message-status-indicator";
import type { Message } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: Message;
  /** Whether this is the last message in the thread. */
  isLatest: boolean;
  /** Whether this message can be retried (only latest failed assistant). */
  canRetry: boolean;
  /** Retry handler — re-sends the preceding user message. */
  onRetry?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MessageBubble = memo(function MessageBubble(props: MessageBubbleProps) {
  const { message, isLatest, canRetry, onRetry, className } = props;
  const isUser = message.role === "user";
  const showStatus =
    !isUser &&
    isLatest &&
    (message.status === "failed" ||
      message.status === "cancelled" ||
      message.status === "streaming");

  return (
    <div
      className={cn(
        "group/message flex w-full gap-2 px-4 py-2",
        isUser ? "justify-end" : "justify-start",
        className
      )}
    >
      <div
        className={cn(
          "relative max-w-[85%] rounded-2xl px-4 py-2.5 md:max-w-[75%]",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted/70 text-foreground"
        )}
      >
        {/* Message content */}
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </p>
        ) : (
          <MemoizedMarkdown content={message.content} />
        )}

        {/* Status indicator for failed/cancelled messages */}
        {showStatus && (
          <MessageStatusIndicator
            status={message.status}
            canRetry={canRetry}
            onRetry={onRetry}
          />
        )}

        {/* Actions bar (hover-visible) */}
        <div
          className={cn(
            "absolute -bottom-6 z-10",
            isUser ? "right-0" : "left-0"
          )}
        >
          <MessageActions content={message.content} role={message.role} />
        </div>
      </div>
    </div>
  );
});

MessageBubble.displayName = "MessageBubble";
