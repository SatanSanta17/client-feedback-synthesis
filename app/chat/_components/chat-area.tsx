"use client";

// ---------------------------------------------------------------------------
// ChatArea — Main chat area (PRD-020 Part 3, Increment 3.3–3.5)
// ---------------------------------------------------------------------------
// Composes: ChatHeader, MessageThread, ChatInput, StarterQuestions.
// Handles empty state, archived read-only state, and streaming wiring.
// Placeholder zone remains for ChatSearchBar (3.6).
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { MessageSquare } from "lucide-react";

import { ChatHeader } from "./chat-header";
import { MessageThread } from "./message-thread";
import { ChatInput } from "./chat-input";
import { StarterQuestions } from "./starter-questions";
import type {
  Conversation,
  Message,
  ChatSource,
  StreamState,
} from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatAreaProps {
  /** The active conversation, or null for new/empty state. */
  activeConversation: Conversation | null;
  /** Messages for the active conversation. */
  messages: Message[];
  /** Whether messages are loading. */
  isLoadingMessages: boolean;
  /** Whether more messages can be loaded. */
  hasMoreMessages: boolean;
  /** Streaming state machine. */
  streamState: StreamState;
  /** Content being accumulated during streaming. */
  streamingContent: string;
  /** Ephemeral status text. */
  statusText: string | null;
  /** Sources from latest completed stream. */
  latestSources: ChatSource[] | null;
  /** Follow-up questions from latest completed stream. */
  latestFollowUps: string[];
  /** Error message. */
  error: string | null;
  /** Sidebar state for header toggle. */
  isSidebarCollapsed: boolean;
  /** Callbacks */
  onFetchMoreMessages: () => Promise<void>;
  onSendMessage: (content: string) => Promise<void>;
  onCancelStream: () => void;
  onRetryLastMessage: () => Promise<void>;
  onToggleSidebar: () => void;
  onOpenMobileSidebar: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatArea(props: ChatAreaProps) {
  const {
    activeConversation,
    messages,
    isLoadingMessages,
    hasMoreMessages,
    streamState,
    streamingContent,
    statusText,
    latestFollowUps,
    error,
    isSidebarCollapsed,
    onFetchMoreMessages,
    onSendMessage,
    onCancelStream,
    onRetryLastMessage,
    onToggleSidebar,
    onOpenMobileSidebar,
  } = props;
  // Props used by later increments: latestSources (reserved for future use)
  const isArchived = activeConversation?.isArchived ?? false;
  const hasConversation = activeConversation !== null;
  const hasMessages = messages.length > 0 || streamState === "streaming";
  const isStreaming = streamState === "streaming";

  // Follow-up chip click → send as a new message
  const handleSendFollowUp = useCallback(
    (question: string) => {
      onSendMessage(question);
    },
    [onSendMessage]
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <ChatHeader
        conversation={activeConversation}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenMobileSidebar={onOpenMobileSidebar}
      />

      {/* Main content area */}
      {!hasConversation && !hasMessages ? (
        /* Empty state — no conversation selected */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
          <div className="rounded-full bg-muted p-3">
            <MessageSquare className="size-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Start a new conversation</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask questions about your client feedback data
            </p>
          </div>
          <StarterQuestions
            onSendMessage={onSendMessage}
            disabled={isStreaming}
          />
        </div>
      ) : (
        /* Message thread */
        <MessageThread
          messages={messages}
          isLoadingMessages={isLoadingMessages}
          hasMoreMessages={hasMoreMessages}
          onFetchMoreMessages={onFetchMoreMessages}
          streamState={streamState}
          streamingContent={streamingContent}
          statusText={statusText}
          onRetry={onRetryLastMessage}
          latestFollowUps={latestFollowUps}
          onSendFollowUp={handleSendFollowUp}
          className="flex-1"
        />
      )}

      {/* Error banner */}
      {error && streamState === "error" && (
        <div className="border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Input area */}
      <ChatInput
        streamState={streamState}
        isArchived={isArchived}
        onSendMessage={onSendMessage}
        onCancelStream={onCancelStream}
      />
    </div>
  );
}
