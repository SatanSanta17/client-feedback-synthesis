"use client";

// ---------------------------------------------------------------------------
// ConversationSidebar — Conversation list panel (PRD-020 Part 3, Increment 3.2)
// ---------------------------------------------------------------------------
// Collapsible on desktop (280px ↔ hidden). Sheet overlay on mobile.
// Contains: new chat button, search input, archive toggle, conversation list.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeft,
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
import { ConversationItem } from "./conversation-item";
import { RenameDialog } from "./rename-dialog";
import type { Conversation } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationSidebarProps {
  className?: string;
  /** Active (non-archived) conversations. */
  conversations: Conversation[];
  /** Filtered conversations (search applied). */
  filteredConversations: Conversation[];
  /** Currently selected conversation ID. */
  activeConversationId: string | null;
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

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);

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
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
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
          <div className="flex flex-col gap-0.5 p-1.5">
            {/* Animated list container for smooth archive toggle */}
            <div
              className="transition-all duration-150 ease-in-out"
              key={isArchiveView ? "archived" : "active"}
            >
              {filteredConversations.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  isArchiveView={isArchiveView}
                  onSelect={() => onSelectConversation(conversation)}
                  onRename={() =>
                    setRenameTarget({
                      id: conversation.id,
                      title: conversation.title,
                    })
                  }
                  onPin={() =>
                    onPin(conversation.id, !conversation.isPinned)
                  }
                  onArchive={() => onArchive(conversation.id)}
                  onUnarchive={() => onUnarchive(conversation.id)}
                />
              ))}
            </div>

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

      {/* Rename dialog */}
      <RenameDialog
        open={renameTarget !== null}
        currentTitle={renameTarget?.title ?? ""}
        onSave={async (newTitle) => {
          if (renameTarget) {
            await onRename(renameTarget.id, newTitle);
          }
          setRenameTarget(null);
        }}
        onClose={() => setRenameTarget(null)}
      />
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

      {/* Desktop expand button (shown when collapsed) */}
      {isCollapsed && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          title="Open sidebar"
          className="hidden md:flex absolute left-2 top-2 z-10"
        >
          <PanelLeft className="size-4" />
        </Button>
      )}

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
