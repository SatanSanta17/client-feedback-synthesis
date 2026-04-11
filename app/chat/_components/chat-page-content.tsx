"use client";

// ---------------------------------------------------------------------------
// ChatPageContent — Client coordinator for /chat (PRD-020 Part 3)
// ---------------------------------------------------------------------------
// Composes ConversationSidebar and chat area placeholder.
// Manages active conversation selection and wires core hooks together.
// ---------------------------------------------------------------------------

import { useState, useCallback } from "react";
import { PanelLeft } from "lucide-react";

import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { useConversations } from "@/lib/hooks/use-conversations";
import { useChat } from "@/lib/hooks/use-chat";
import { ConversationSidebar } from "./conversation-sidebar";
import type { Conversation } from "@/lib/types/chat";

export function ChatPageContent() {
  const { user } = useAuth();
  const teamId = null; // TODO: wire active team from context when teams are implemented

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
  const handleConversationCreated = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

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
    teamId,
    onConversationCreated: handleConversationCreated,
    onTitleGenerated: handleTitleGenerated,
  });

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

  if (!user) {
    return null;
  }

  return (
    <div className="relative flex h-full w-full">
      <ConversationSidebar
        conversations={conversationsHook.conversations}
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
        onMobileClose={() => setIsMobileSidebarOpen(false)}
      />

      {/* Chat Area — placeholder for Increment 3.3 */}
      <div className="flex flex-1 flex-col">
        {/* Mobile header with sidebar toggle */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsMobileSidebarOpen(true)}
          >
            <PanelLeft className="size-4" />
          </Button>
          <span className="text-sm font-medium">Chat</span>
        </div>

        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {activeConversationId
            ? `Chat: ${activeConversationId.slice(0, 8)}…`
            : "Select or start a new conversation"}
        </div>
        <div className="p-4 text-xs text-muted-foreground">
          Stream state: {chatHook.streamState}
          {chatHook.error && ` | Error: ${chatHook.error}`}
        </div>
      </div>
    </div>
  );
}
