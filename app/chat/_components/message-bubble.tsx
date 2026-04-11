"use client";

// ---------------------------------------------------------------------------
// MessageBubble — Single message rendering (PRD-020 Part 3, Increment 3.3–3.5)
// ---------------------------------------------------------------------------
// User messages: right-aligned, coloured background.
// Assistant messages: left-aligned, neutral background, markdown rendered.
// Shows citations, follow-up chips, and status indicator as appropriate.
// ---------------------------------------------------------------------------

import { memo } from "react";

import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "./memoized-markdown";
import { HighlightedText } from "./highlighted-text";
import { MessageActions } from "./message-actions";
import { MessageStatusIndicator } from "./message-status-indicator";
import { CitationChips } from "./citation-chips";
import { FollowUpChips } from "./follow-up-chips";
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
  /** Follow-up questions (only set on the latest completed assistant message). */
  followUps?: string[];
  /** Called when a follow-up chip is clicked. */
  onSendFollowUp?: (question: string) => void;
  /** Active search query for text highlighting. */
  searchQuery?: string | null;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MessageBubble = memo(function MessageBubble(props: MessageBubbleProps) {
  const {
    message,
    isLatest,
    canRetry,
    onRetry,
    followUps,
    onSendFollowUp,
    searchQuery,
    className,
  } = props;
  const isUser = message.role === "user";
  const showStatus =
    !isUser &&
    isLatest &&
    (message.status === "failed" ||
      message.status === "cancelled" ||
      message.status === "streaming");

  const hasSources =
    !isUser && message.sources && message.sources.length > 0;
  const showFollowUps =
    !isUser &&
    isLatest &&
    message.status === "completed" &&
    followUps &&
    followUps.length > 0 &&
    onSendFollowUp;

  return (
    <div
      className={cn(
        "group/message flex w-full px-4 py-2",
        isUser ? "justify-end" : "justify-start",
        className
      )}
    >
      {/* Column wrapper — keeps bubble + follow-ups stacked vertically */}
      <div className="flex max-w-[85%] flex-col md:max-w-[75%]">
        <div
          className={cn(
            "relative rounded-2xl px-4 py-2.5",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted/70 text-foreground"
          )}
        >
          {/* Message content */}
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              <HighlightedText text={message.content} searchQuery={searchQuery} />
            </p>
          ) : (
            <MemoizedMarkdown content={message.content} searchQuery={searchQuery} />
          )}

          {/* Citation chips — below assistant content when sources exist */}
          {hasSources && <CitationChips sources={message.sources!} />}

          {/* Status indicator for failed/cancelled messages */}
          {showStatus && (
            <MessageStatusIndicator
              status={message.status}
              canRetry={canRetry}
              onRetry={onRetry}
            />
          )}

          {/* Actions bar (hover-visible) — force foreground colour so the icon
              is visible below user bubbles (which set text-primary-foreground). */}
          <div
            className={cn(
              "absolute -bottom-6 z-10 text-foreground",
              isUser ? "right-0" : "left-0"
            )}
          >
            <MessageActions content={message.content} role={message.role} />
          </div>
        </div>

        {/* Follow-up chips — outside the bubble, stacked below */}
        {showFollowUps && (
          <FollowUpChips
            questions={followUps!}
            onSendFollowUp={onSendFollowUp!}
            className="mt-6"
          />
        )}
      </div>
    </div>
  );
});

MessageBubble.displayName = "MessageBubble";
