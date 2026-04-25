"use client";

// ---------------------------------------------------------------------------
// ChatPageContent — Client coordinator for /chat (PRD-020 Part 3, gap P9)
// ---------------------------------------------------------------------------
// Composes ConversationSidebar and ChatArea. Holds the active conversation
// UUID and wires core hooks together. URL → state seeding happens via the
// `initialConversationId` prop; `null` ↔ fresh chat with no DB row yet.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect, useMemo } from "react";

import { useAuth } from "@/components/providers/auth-provider";
import { useConversations } from "@/lib/hooks/use-conversations";
import { useChat } from "@/lib/hooks/use-chat";
import { ConversationSidebar } from "./conversation-sidebar";
import { ChatArea } from "./chat-area";
import type { Conversation } from "@/lib/types/chat";

// Same UUID shape the [id] route file enforces. Kept inline (not extracted
// into a shared util) because both call sites are tiny and self-contained.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses /chat/<id> → id. Returns null for /chat or any non-matching path. */
function parseConversationIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/?#]+)/);
  if (!match) return null;
  const id = match[1];
  return UUID_REGEX.test(id) ? id : null;
}

interface ChatPageContentProps {
  /**
   * Conversation UUID seeded from the URL when this is rendered from
   * `app/chat/[id]/page.tsx`. Absent on the `/chat` fresh-chat entry —
   * `null` then means "no DB row yet, no conversation selected." (Gap P9)
   */
  initialConversationId?: string;
}

export function ChatPageContent({
  initialConversationId,
}: ChatPageContentProps = {}) {
  const { user, activeTeamId } = useAuth();
  const teamId = activeTeamId ?? null;

  // Active conversation UUID. `null` = fresh chat / no DB row yet (gap P9).
  // When the URL seeds an id (`/chat/<uuid>`), use it. Otherwise start null;
  // the UUID materialises on first send via `useChat.sendMessage` and the
  // `onConversationCreated` callback below.
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(initialConversationId ?? null);

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

  // Silently sync URL + state when the server confirms a new conversation.
  // history.pushState (not replaceState) so the natural browser history
  // chain is preserved: ..., /chat (the entry point), /chat/<id> (after
  // first send). Back-button takes the user from /chat/<id> → /chat (empty
  // fresh chat) → wherever they came from. No clearMessages — messages are
  // already populated by the streaming flow; clearing would clobber them. (Gap P9)
  const silentlyAssignConversationId = useCallback((id: string) => {
    window.history.pushState(null, "", `/chat/${id}`);
    setActiveConversationId(id);
  }, []);

  // First-send notification from useChat — fires once, after the server
  // confirms the new conversation via `X-Conversation-Id` response header.
  // Order: silent URL+state assignment first, then sidebar prepend.
  const handleConversationCreated = useCallback(
    (id: string) => {
      silentlyAssignConversationId(id);
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
    [silentlyAssignConversationId, prependConversation, teamId, user?.id]
  );

  // Chat streaming
  const chatHook = useChat({
    conversationId: activeConversationId,
    onConversationCreated: handleConversationCreated,
    onTitleGenerated: handleTitleGenerated,
  });

  // Derive active conversation object from the list. Returns null when no
  // conversation is selected (fresh chat) or when the URL-supplied UUID
  // hasn't appeared in either list yet (still loading, or the conversation
  // belongs to a different user — handled by the 404 path in Increment 3).
  const activeConversation = useMemo(
    () =>
      activeConversationId
        ? conversationsHook.conversations.find(
            (c) => c.id === activeConversationId
          ) ??
          conversationsHook.archivedConversations.find(
            (c) => c.id === activeConversationId
          ) ??
          null
        : null,
    [
      activeConversationId,
      conversationsHook.conversations,
      conversationsHook.archivedConversations,
    ]
  );

  // In-app navigation primitives — use raw window.history API so the chat
  // shell never remounts (gap P9). clearMessages + setActiveConversationId
  // batch into one render commit, so the previous conversation's messages
  // never flash with the new conversation's header.
  const { clearMessages } = chatHook;

  const navigateToConversation = useCallback(
    (id: string) => {
      window.history.pushState(null, "", `/chat/${id}`);
      clearMessages();
      setActiveConversationId(id);
    },
    [clearMessages]
  );

  const navigateToFreshChat = useCallback(() => {
    window.history.pushState(null, "", "/chat");
    clearMessages();
    setActiveConversationId(null);
  }, [clearMessages]);

  // Sidebar callbacks
  const handleSelectConversation = useCallback(
    (conversation: Conversation) => {
      navigateToConversation(conversation.id);
      setIsMobileSidebarOpen(false);
    },
    [navigateToConversation]
  );

  const handleNewChat = useCallback(() => {
    navigateToFreshChat();
    setIsMobileSidebarOpen(false);
  }, [navigateToFreshChat]);

  // Browser back/forward sync. The user's pushState calls put entries in
  // the history stack; popstate fires when they press the back/forward
  // button. Read the URL and atomically clear messages + set the new
  // active id — both are React state updates so they batch into one
  // render commit, no flash of stale messages. (Gap P9)
  useEffect(() => {
    function onPopState() {
      const id = parseConversationIdFromPath(window.location.pathname);
      clearMessages();
      setActiveConversationId(id);
      setIsMobileSidebarOpen(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [clearMessages]);

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
        activeConversationId={activeConversationId}
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
        isConversationNotFound={chatHook.isConversationNotFound}
        isSidebarCollapsed={isSidebarCollapsed}
        onFetchMoreMessages={chatHook.fetchMoreMessages}
        onSendMessage={chatHook.sendMessage}
        onCancelStream={chatHook.cancelStream}
        onRetryLastMessage={chatHook.retryLastMessage}
        onUnarchive={handleUnarchiveActive}
        onToggleSidebar={handleToggleSidebar}
        onOpenMobileSidebar={handleOpenMobileSidebar}
        onStartNewChat={navigateToFreshChat}
      />
    </div>
  );
}
