"use client";

import { useState, useCallback } from "react";

import { useAuth } from "@/components/providers/auth-provider";
import { useConversations } from "@/lib/hooks/use-conversations";
import { useChat } from "@/lib/hooks/use-chat";

/**
 * Client coordinator for the /chat route.
 * Composes the conversation sidebar and chat area, managing the active
 * conversation selection and wiring the two core hooks together.
 *
 * Increment 3.1: renders placeholder divs — styled UI comes in later increments.
 */
export function ChatPageContent() {
  const { user } = useAuth();
  const teamId = null; // TODO: wire active team from context when teams are implemented

  // Active conversation selection
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);

  // Conversation list management
  const conversationsHook = useConversations({
    teamId,
    activeConversationId,
  });

  // Handle new conversation creation from chat hook
  const handleConversationCreated = useCallback(
    (id: string) => {
      setActiveConversationId(id);
      // Refetch conversations to pick up the new one
      // The useConversations hook will handle prepending
    },
    []
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
    teamId,
    onConversationCreated: handleConversationCreated,
    onTitleGenerated: handleTitleGenerated,
  });

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-full w-full">
      {/* Conversation Sidebar — placeholder for Increment 3.2 */}
      <div className="w-[280px] shrink-0 border-r border-border bg-muted/30">
        <div className="p-4 text-sm text-muted-foreground">
          Conversations ({conversationsHook.conversations.length})
          {conversationsHook.isLoading && " — Loading..."}
        </div>
      </div>

      {/* Chat Area — placeholder for Increment 3.3 */}
      <div className="flex flex-1 flex-col">
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
