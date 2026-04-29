"use client";

// ---------------------------------------------------------------------------
// ChatArea — Main chat area (PRD-020 Part 3, Increment 3.3–3.6)
// ---------------------------------------------------------------------------
// Composes: ChatHeader, ChatSearchBar, MessageThread, ChatInput, StarterQuestions.
// Manages in-conversation search state (query, match indices, navigation).
// Handles empty state, archived read-only state, and streaming wiring.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo, useEffect } from "react";
import { FileQuestion, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  MAX_CONCURRENT_STREAMS,
  useActiveStreamCount,
} from "@/lib/streaming";
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
  /**
   * Active conversation UUID — `null` means "fresh chat, no DB row yet"
   * (URL is `/chat`). When non-null, the user has either deep-linked to
   * a known conversation OR just sent the first message and the server
   * confirmed via header. Used for the empty-state vs. message-thread
   * branch — the looked-up `activeConversation` may briefly be null
   * during the conversations-list fetch window even though the id is
   * set, and we don't want to flash the fresh-chat starter panel in
   * that case. (Gap P9)
   */
  activeConversationId: string | null;
  /**
   * Active workspace — NULL = personal. Threaded through to `ChatInput`
   * for the per-workspace concurrent-stream cap (PRD-024 P3.R3).
   */
  teamId: string | null;
  /** The active conversation looked up from the sidebar list, or null
   *  when no conversation is selected OR while the list is still loading. */
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
  /**
   * True when the messages-list fetch returned 404 (conversation doesn't
   * exist or is inaccessible). Surfaces a "Conversation not found" UI in
   * place of the message thread / empty state. (Gap P9)
   */
  isConversationNotFound: boolean;
  /** Sidebar state for header toggle. */
  isSidebarCollapsed: boolean;
  /** Callbacks */
  onFetchMoreMessages: () => Promise<void>;
  onSendMessage: (content: string) => Promise<void>;
  onCancelStream: () => void;
  onRetryLastMessage: () => Promise<void>;
  onUnarchive?: () => void;
  onToggleSidebar: () => void;
  onOpenMobileSidebar: () => void;
  /**
   * "Start a new chat" CTA inside the 404 panel — wired to the parent's
   * navigateToFreshChat (window.history.pushState + reset state). (Gap P9)
   */
  onStartNewChat: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatArea(props: ChatAreaProps) {
  const {
    activeConversationId,
    teamId,
    activeConversation,
    messages,
    isLoadingMessages,
    hasMoreMessages,
    streamState,
    streamingContent,
    statusText,
    latestFollowUps,
    error,
    isConversationNotFound,
    isSidebarCollapsed,
    onFetchMoreMessages,
    onSendMessage,
    onCancelStream,
    onRetryLastMessage,
    onUnarchive,
    onToggleSidebar,
    onOpenMobileSidebar,
    onStartNewChat,
  } = props;
  // Props reserved for future use: latestSources
  const isArchived = activeConversation?.isArchived ?? false;
  const isFreshChat = activeConversationId === null;
  const hasMessages = messages.length > 0 || streamState === "streaming";
  const isStreaming = streamState === "streaming";

  // Workspace-scoped concurrent-stream cap (PRD-024 P3.R3). Owned here so
  // every input surface — chat-input, starter questions — gates against
  // the same source of truth. Without this, follow-up paths to
  // onSendMessage (Enter key, starter-question click) would bypass any
  // cap state local to chat-input.
  const activeStreamCount = useActiveStreamCount(teamId);
  const capReached = activeStreamCount >= MAX_CONCURRENT_STREAMS;

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

  // Follow-up chip click → insert into textarea for review/edit.
  // Wrap in an object so React sees a new reference even if the same text
  // is clicked twice (e.g. user clears the textarea and re-clicks).
  const [suggestedText, setSuggestedText] = useState<{
    text: string;
    ts: number;
  } | null>(null);
  const handleSendFollowUp = useCallback((question: string) => {
    setSuggestedText({ text: question, ts: Date.now() });
  }, []);

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
      {isConversationNotFound ? (
        /* 404 — conversation doesn't exist or isn't accessible (gap P9) */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
          <div className="rounded-full bg-muted p-3">
            <FileQuestion
              className="size-6 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Conversation not found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This chat doesn&apos;t exist or you don&apos;t have access to it.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onStartNewChat}>
            Start a new chat
          </Button>
        </div>
      ) : isFreshChat && !hasMessages ? (
        /* Fresh-chat empty state — only when activeConversationId is null
           (URL `/chat`). When the URL has an id but the sidebar lookup
           hasn't resolved yet, fall through to MessageThread which renders
           a loading skeleton via `isLoadingMessages`. (Gap P9) */
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
            disabled={isStreaming || capReached}
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

      {/* Input area — hidden when the conversation isn't accessible (gap P9) */}
      {!isConversationNotFound && (
        <ChatInput
          streamState={streamState}
          capReached={capReached}
          isArchived={isArchived}
          suggestedText={suggestedText}
          onSendMessage={onSendMessage}
          onCancelStream={onCancelStream}
          onUnarchive={isArchived ? onUnarchive : undefined}
        />
      )}
    </div>
  );
}
