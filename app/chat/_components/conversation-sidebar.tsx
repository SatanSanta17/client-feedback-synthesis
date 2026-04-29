"use client";

// ---------------------------------------------------------------------------
// ConversationSidebar — Conversation list panel (PRD-020 Part 3, Increment 3.2)
// ---------------------------------------------------------------------------
// Collapsible on desktop (280px ↔ hidden). Sheet overlay on mobile.
// Contains: new chat button, search input, archive toggle, conversation list.
// ---------------------------------------------------------------------------

import { useState, useMemo } from "react";
import {
  Archive,
  ArchiveRestore,
  MessageSquarePlus,
  PanelLeftClose,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useActiveStreamCount } from "@/lib/streaming";
import { ConversationItem } from "./conversation-item";
import type { Conversation } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationSidebarProps {
  className?: string;
  /** Filtered conversations (search applied). */
  filteredConversations: Conversation[];
  /** Currently selected conversation ID. */
  activeConversationId: string | null;
  /**
   * Active workspace — NULL = personal. Used to scope the footer's
   * aggregate streaming-count text (PRD-024 P4.R4) to the current
   * workspace; cross-workspace streams don't appear in the count.
   */
  teamId: string | null;
  /** Whether viewing archived conversations. */
  isArchiveView: boolean;
  /** Whether initial load is in progress. */
  isLoading: boolean;
  /** Whether more pages can be loaded. */
  hasMore: boolean;
  /** Current search query. */
  searchQuery: string;
  /** Sidebar collapsed state (desktop). */
  isCollapsed: boolean;
  /** Mobile sheet open state. */
  isMobileOpen: boolean;
  /** Callbacks */
  onSelectConversation: (conversation: Conversation) => void;
  onNewChat: () => void;
  onToggleArchiveView: () => void;
  onFetchMore: () => Promise<void>;
  onSetSearchQuery: (q: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onUnarchive: (id: string) => Promise<void>;
  onToggleCollapsed: () => void;
  onMobileClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConversationSidebar({
  className,
  filteredConversations,
  activeConversationId,
  teamId,
  isArchiveView,
  isLoading,
  hasMore,
  searchQuery,
  isCollapsed,
  isMobileOpen,
  onSelectConversation,
  onNewChat,
  onToggleArchiveView,
  onFetchMore,
  onSetSearchQuery,
  onRename,
  onPin,
  onArchive,
  onUnarchive,
  onToggleCollapsed,
  onMobileClose,
}: ConversationSidebarProps) {
  // Search bar visibility
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Footer text (PRD-024 P4.R4) — workspace-scoped streaming count with
  // explicit singular/plural so future i18n catalogs can swap each branch
  // independently. Updates reactively as streams start/complete.
  const activeStreamCount = useActiveStreamCount(teamId);
  const footerText =
    activeStreamCount === 0
      ? "Start a conversation"
      : activeStreamCount === 1
        ? "1 chat is streaming"
        : `${activeStreamCount} chats are streaming`;

  // Split conversations into pinned and unpinned groups
  const { pinnedConversations, unpinnedConversations } = useMemo(() => {
    const pinned: Conversation[] = [];
    const unpinned: Conversation[] = [];
    for (const c of filteredConversations) {
      if (c.isPinned) pinned.push(c);
      else unpinned.push(c);
    }
    return { pinnedConversations: pinned, unpinnedConversations: unpinned };
  }, [filteredConversations]);

  // Shared sidebar content (used both in desktop panel and mobile sheet)
  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNewChat}
          title="New chat"
        >
          <MessageSquarePlus className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            setIsSearchOpen((prev) => !prev);
            if (isSearchOpen) onSetSearchQuery("");
          }}
          title="Search conversations"
        >
          <Search className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleArchiveView}
          title={isArchiveView ? "View active" : "View archived"}
          className={cn(
            "transition-colors",
            isArchiveView && "text-primary"
          )}
        >
          {isArchiveView ? (
            <ArchiveRestore className="size-4" />
          ) : (
            <Archive className="size-4" />
          )}
        </Button>

        <div className="flex-1" />

        {/* Desktop collapse toggle */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          title="Close sidebar"
          className="hidden md:flex"
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </div>

      {/* Search input */}
      {isSearchOpen && (
        <div className="border-b border-border px-3 py-2">
          <div className="relative">
            <Input
              placeholder="Search conversations…"
              value={searchQuery}
              onChange={(e) => onSetSearchQuery(e.target.value)}
              className="h-7 pr-7 text-xs"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => onSetSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Archive view label */}
      {isArchiveView && (
        <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          Archived conversations
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-lg bg-muted/50"
              />
            ))}
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {searchQuery
              ? "No matching conversations"
              : isArchiveView
                ? "No archived conversations"
                : "No conversations yet"}
          </div>
        ) : (
          <div
            className="flex flex-col gap-0.5 p-1.5 transition-all duration-150 ease-in-out"
            key={isArchiveView ? "archived" : "active"}
          >
            {/* Pinned section — only shown when pinned conversations exist */}
            {pinnedConversations.length > 0 && (
              <>
                <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Pinned
                </div>
                {pinnedConversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeConversationId}
                    isArchiveView={isArchiveView}
                    onSelect={() => onSelectConversation(conversation)}
                    onRename={onRename}
                    onPin={() =>
                      onPin(conversation.id, !conversation.isPinned)
                    }
                    onArchive={() => onArchive(conversation.id)}
                    onUnarchive={() => onUnarchive(conversation.id)}
                  />
                ))}

                {/* Separator between pinned and unpinned */}
                {unpinnedConversations.length > 0 && (
                  <div className="my-1 border-t border-border" />
                )}
              </>
            )}

            {/* Unpinned conversations */}
            {unpinnedConversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === activeConversationId}
                isArchiveView={isArchiveView}
                onSelect={() => onSelectConversation(conversation)}
                onRename={onRename}
                onPin={() =>
                  onPin(conversation.id, !conversation.isPinned)
                }
                onArchive={() => onArchive(conversation.id)}
                onUnarchive={() => onUnarchive(conversation.id)}
              />
            ))}

            {/* Load more */}
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onFetchMore}
                className="mt-1 w-full text-xs text-muted-foreground"
              >
                Load more
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Footer — aggregate streaming status (PRD-024 P4.R4) */}
      <p
        aria-live="polite"
        className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground"
      >
        {footerText}
      </p>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className={cn(
          "hidden md:flex h-full flex-col border-r border-border bg-muted/30 transition-[width] duration-200 ease-in-out overflow-hidden",
          isCollapsed ? "w-0" : "w-[280px]",
          className
        )}
      >
        {!isCollapsed && sidebarContent}
      </div>

      {/* Mobile sheet */}
      <Sheet open={isMobileOpen} onOpenChange={(open) => !open && onMobileClose()}>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
}
