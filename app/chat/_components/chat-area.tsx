"use client";

// ---------------------------------------------------------------------------
// ChatArea — Main chat area (PRD-020 Part 3, Increment 3.3)
// ---------------------------------------------------------------------------
// Composes: ChatHeader, MessageThread, and placeholder zones for
// ChatInput (3.4), StarterQuestions (3.5), and ChatSearchBar (3.6).
// Handles empty state and archived read-only state.
// ---------------------------------------------------------------------------

import { MessageSquare } from "lucide-react";

import { ChatHeader } from "./chat-header";
import { MessageThread } from "./message-thread";
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
    statusText,
    isSidebarCollapsed,
    onFetchMoreMessages,
    onToggleSidebar,
    onOpenMobileSidebar,
  } = props;
  // Props used by later increments: streamingContent, error,
  // onSendMessage, onCancelStream, onRetryLastMessage, latestSources,
  // latestFollowUps — destructured when their UI components are added.
  const isArchived = activeConversation?.isArchived ?? false;
  const hasConversation = activeConversation !== null;
  const hasMessages = messages.length > 0 || streamState === "streaming";

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
          {/* StarterQuestions will be added in Increment 3.5 */}
        </div>
      ) : (
        /* Message thread */
        <MessageThread
          messages={messages}
          isLoadingMessages={isLoadingMessages}
          hasMoreMessages={hasMoreMessages}
          onFetchMoreMessages={onFetchMoreMessages}
          className="flex-1"
        />
      )}

      {/* Input area — placeholder for Increment 3.4 (ChatInput) */}
      {isArchived ? (
        <div className="flex items-center justify-center gap-2 border-t border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          This conversation is archived.
          {/* Unarchive button will be wired in Increment 3.7 */}
        </div>
      ) : (
        <div className="border-t border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">
            {streamState === "streaming"
              ? statusText ?? "Generating…"
              : "Input area — will be built in Increment 3.4"}
          </div>
        </div>
      )}
    </div>
  );
}
