"use client";

// ---------------------------------------------------------------------------
// ChatArea — Main chat area (PRD-020 Part 3, Increment 3.3–3.6)
// ---------------------------------------------------------------------------
// Composes: ChatHeader, ChatSearchBar, MessageThread, ChatInput, StarterQuestions.
// Manages in-conversation search state (query, match indices, navigation).
// Handles empty state, archived read-only state, and streaming wiring.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo, useEffect } from "react";
import { MessageSquare } from "lucide-react";

import { ChatHeader } from "./chat-header";
import { ChatSearchBar } from "./chat-search-bar";
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
  // Props reserved for future use: latestSources
  const isArchived = activeConversation?.isArchived ?? false;
  const hasConversation = activeConversation !== null;
  const hasMessages = messages.length > 0 || streamState === "streaming";
  const isStreaming = streamState === "streaming";

  // -------------------------------------------------------------------------
  // In-conversation search state
  // -------------------------------------------------------------------------

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Compute which message indices match the search query (case-insensitive)
  const searchMatchIndices = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].content.toLowerCase().includes(q)) {
        indices.push(i);
      }
    }
    return indices;
  }, [messages, searchQuery]);

  // Reset currentMatchIndex when matches change
  useEffect(() => {
    if (searchMatchIndices.length > 0) {
      setCurrentMatchIndex(0);
    }
  }, [searchMatchIndices.length]);

  // The message index to scroll to (null when no match)
  const scrollToMessageIndex =
    searchMatchIndices.length > 0
      ? searchMatchIndices[currentMatchIndex] ?? null
      : null;

  // Search navigation
  const handleSearchPrev = useCallback(() => {
    setCurrentMatchIndex((prev) =>
      searchMatchIndices.length === 0
        ? 0
        : (prev - 1 + searchMatchIndices.length) % searchMatchIndices.length
    );
  }, [searchMatchIndices.length]);

  const handleSearchNext = useCallback(() => {
    setCurrentMatchIndex((prev) =>
      searchMatchIndices.length === 0
        ? 0
        : (prev + 1) % searchMatchIndices.length
    );
  }, [searchMatchIndices.length]);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => {
      if (prev) {
        // Closing: clear query
        setSearchQuery("");
        setCurrentMatchIndex(0);
      }
      return !prev;
    });
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setCurrentMatchIndex(0);
  }, []);

  // Close search when conversation changes
  useEffect(() => {
    handleCloseSearch();
  }, [activeConversation?.id, handleCloseSearch]);

  // Keyboard shortcut: Ctrl/Cmd+F to open search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && hasMessages) {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [hasMessages]);

  // Follow-up chip click → send as a new message
  const handleSendFollowUp = useCallback(
    (question: string) => {
      onSendMessage(question);
    },
    [onSendMessage]
  );

  // Active search query to pass down (only when search is open and has text)
  const activeSearchQuery = isSearchOpen && searchQuery.trim() ? searchQuery : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <ChatHeader
        conversation={activeConversation}
        isSidebarCollapsed={isSidebarCollapsed}
        hasMessages={hasMessages}
        onToggleSidebar={onToggleSidebar}
        onOpenMobileSidebar={onOpenMobileSidebar}
        onToggleSearch={handleToggleSearch}
      />

      {/* Search bar (slides in below header) */}
      {isSearchOpen && (
        <ChatSearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          matchCount={searchMatchIndices.length}
          currentMatchIndex={currentMatchIndex}
          onPrev={handleSearchPrev}
          onNext={handleSearchNext}
          onClose={handleCloseSearch}
        />
      )}

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
          searchQuery={activeSearchQuery}
          scrollToMessageIndex={scrollToMessageIndex}
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
