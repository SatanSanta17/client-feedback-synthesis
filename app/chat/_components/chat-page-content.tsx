"use client";

// ---------------------------------------------------------------------------
// ChatPageContent — Client coordinator for /chat (PRD-020 Part 3)
// ---------------------------------------------------------------------------
// Composes ConversationSidebar and ChatArea.
// Manages active conversation selection and wires core hooks together.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from "react";

import { useAuth } from "@/components/providers/auth-provider";
import { useConversations } from "@/lib/hooks/use-conversations";
import { useChat } from "@/lib/hooks/use-chat";
import { ConversationSidebar } from "./conversation-sidebar";
import { ChatArea } from "./chat-area";
import type { Conversation } from "@/lib/types/chat";

export function ChatPageContent() {
  const { user, activeTeamId } = useAuth();
  const teamId = activeTeamId ?? null;

  // Active conversation UUID — client-generated end-to-end (gap E15). Always
  // a real UUID. The DB row is created idempotently on the first POST using
  // this UUID; up until that first send the conversation only exists
  // client-side.
  const [activeConversationId, setActiveConversationId] = useState<string>(() =>
    crypto.randomUUID()
  );

  // Sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Conversation list management
  const conversationsHook = useConversations({
    teamId,
    activeConversationId,
  });

  const { prependConversation } = conversationsHook;

  // Handle async title generation
  const { updateConversation } = conversationsHook;
  const handleTitleGenerated = useCallback(
    (id: string, title: string) => {
      updateConversation(id, { title });
    },
    [updateConversation]
  );

  // True when the active conversationId is a freshly-generated local UUID
  // not yet present in either sidebar list — i.e. the DB row doesn't exist
  // yet. Used by useChat to skip the load-messages fetch (which would 404).
  // Flips to false the moment `handleSendMessage` prepends to the list.
  const isFresh = useMemo(
    () =>
      !(
        conversationsHook.conversations.some(
          (c) => c.id === activeConversationId
        ) ||
        conversationsHook.archivedConversations.some(
          (c) => c.id === activeConversationId
        )
      ),
    [
      activeConversationId,
      conversationsHook.conversations,
      conversationsHook.archivedConversations,
    ]
  );

  // Chat streaming
  const chatHook = useChat({
    conversationId: activeConversationId,
    isFresh,
    onTitleGenerated: handleTitleGenerated,
  });

  // Derive active conversation object from the list. Returns null when the
  // active UUID isn't in either list — i.e. a fresh local chat that hasn't
  // been sent yet (no DB row exists yet under E15's idempotent contract).
  const activeConversation = useMemo(
    () =>
      conversationsHook.conversations.find(
        (c) => c.id === activeConversationId
      ) ??
      conversationsHook.archivedConversations.find(
        (c) => c.id === activeConversationId
      ) ??
      null,
    [
      activeConversationId,
      conversationsHook.conversations,
      conversationsHook.archivedConversations,
    ]
  );

  // First-send sidebar prepend (gap E15). When the conversation is fresh
  // (UUID not yet in either sidebar list), optimistically add it to the
  // sidebar before the underlying sendMessage POST. The server creates the
  // DB row idempotently on this same POST. Once prepended, `isFresh` flips
  // to false on the next render and useChat's load-messages effect treats
  // the conversation as persisted.
  const { sendMessage: rawSendMessage } = chatHook;
  const handleSendMessage = useCallback(
    async (content: string) => {
      if (isFresh) {
        prependConversation({
          id: activeConversationId,
          title: "New conversation",
          createdBy: user?.id ?? "",
          teamId,
          isPinned: false,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      return rawSendMessage(content);
    },
    [
      activeConversationId,
      isFresh,
      prependConversation,
      rawSendMessage,
      teamId,
      user?.id,
    ]
  );

  // Sidebar callbacks
  const handleSelectConversation = useCallback(
    (conversation: Conversation) => {
      setActiveConversationId(conversation.id);
      setIsMobileSidebarOpen(false);
    },
    []
  );

  const handleNewChat = useCallback(() => {
    // Generate a fresh UUID for the new chat — the DB row gets created on
    // first send via the server's idempotent get-or-create (gap E15).
    setActiveConversationId(crypto.randomUUID());
    setIsMobileSidebarOpen(false);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const handleOpenMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(true);
  }, []);

  const handleCloseMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(false);
  }, []);

  // Unarchive the active conversation from the chat area
  const handleUnarchiveActive = useCallback(() => {
    if (activeConversationId) {
      conversationsHook.unarchiveConversation(activeConversationId);
    }
  }, [activeConversationId, conversationsHook.unarchiveConversation]);

  if (!user) {
    return null;
  }

  return (
    <div className="relative flex h-full w-full">
      <ConversationSidebar
        filteredConversations={conversationsHook.filteredConversations}
        activeConversationId={activeConversationId}
        isArchiveView={conversationsHook.isArchiveView}
        isLoading={conversationsHook.isLoading}
        hasMore={conversationsHook.hasMore}
        searchQuery={conversationsHook.searchQuery}
        isCollapsed={isSidebarCollapsed}
        isMobileOpen={isMobileSidebarOpen}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onToggleArchiveView={conversationsHook.toggleArchiveView}
        onFetchMore={conversationsHook.fetchMore}
        onSetSearchQuery={conversationsHook.setSearchQuery}
        onRename={conversationsHook.renameConversation}
        onPin={conversationsHook.pinConversation}
        onArchive={conversationsHook.archiveConversation}
        onUnarchive={conversationsHook.unarchiveConversation}
        onToggleCollapsed={handleToggleSidebar}
        onMobileClose={handleCloseMobileSidebar}
      />

      <ChatArea
        activeConversation={activeConversation}
        messages={chatHook.messages}
        isLoadingMessages={chatHook.isLoadingMessages}
        hasMoreMessages={chatHook.hasMoreMessages}
        streamState={chatHook.streamState}
        streamingContent={chatHook.streamingContent}
        statusText={chatHook.statusText}
        latestSources={chatHook.latestSources}
        latestFollowUps={chatHook.latestFollowUps}
        error={chatHook.error}
        isSidebarCollapsed={isSidebarCollapsed}
        onFetchMoreMessages={chatHook.fetchMoreMessages}
        onSendMessage={handleSendMessage}
        onCancelStream={chatHook.cancelStream}
        onRetryLastMessage={chatHook.retryLastMessage}
        onUnarchive={handleUnarchiveActive}
        onToggleSidebar={handleToggleSidebar}
        onOpenMobileSidebar={handleOpenMobileSidebar}
      />
    </div>
  );
}
