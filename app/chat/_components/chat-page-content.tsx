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

  // Active conversation selection
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);

  // Sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Conversation list management
  const conversationsHook = useConversations({
    teamId,
    activeConversationId,
  });

  // Handle new conversation creation from chat hook
  const { prependConversation } = conversationsHook;
  const handleConversationCreated = useCallback(
    (id: string) => {
      setActiveConversationId(id);
      // Add a placeholder conversation to the sidebar so it appears immediately.
      // The title will be updated asynchronously by the fire-and-forget title
      // generation via handleTitleGenerated / conversation list refetch.
      prependConversation({
        id,
        title: "New conversation",
        createdBy: user?.id ?? "",
        teamId,
        isPinned: false,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
    [prependConversation, user?.id, teamId]
  );

  // Handle async title generation
  const { updateConversation } = conversationsHook;
  const handleTitleGenerated = useCallback(
    (id: string, title: string) => {
      updateConversation(id, { title });
    },
    [updateConversation]
  );

  // Chat streaming
  const chatHook = useChat({
    conversationId: activeConversationId,
    onConversationCreated: handleConversationCreated,
    onTitleGenerated: handleTitleGenerated,
  });

  // Derive active conversation object from the list
  const activeConversation = useMemo(() => {
    if (!activeConversationId) return null;
    return (
      conversationsHook.conversations.find(
        (c) => c.id === activeConversationId
      ) ??
      conversationsHook.archivedConversations.find(
        (c) => c.id === activeConversationId
      ) ??
      null
    );
  }, [
    activeConversationId,
    conversationsHook.conversations,
    conversationsHook.archivedConversations,
  ]);

  // Sidebar callbacks
  const handleSelectConversation = useCallback(
    (conversation: Conversation) => {
      setActiveConversationId(conversation.id);
      setIsMobileSidebarOpen(false);
    },
    []
  );

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
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
        onSendMessage={chatHook.sendMessage}
        onCancelStream={chatHook.cancelStream}
        onRetryLastMessage={chatHook.retryLastMessage}
        onUnarchive={handleUnarchiveActive}
        onToggleSidebar={handleToggleSidebar}
        onOpenMobileSidebar={handleOpenMobileSidebar}
      />
    </div>
  );
}
