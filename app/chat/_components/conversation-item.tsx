"use client";

// ---------------------------------------------------------------------------
// ConversationItem — Single conversation row (PRD-020 Part 3, Increment 3.2)
// ---------------------------------------------------------------------------
// Displays truncated title, relative timestamp, pin indicator.
// Triggers context menu on overflow button click.
// ---------------------------------------------------------------------------

import { memo } from "react";
import { Pin } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format-relative-time";
import { ConversationContextMenu } from "./conversation-context-menu";
import type { Conversation } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationItemProps {
  className?: string;
  conversation: Conversation;
  isActive: boolean;
  isArchiveView: boolean;
  onSelect: () => void;
  onRename: () => void;
  onPin: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ConversationItem = memo(function ConversationItem({
  className,
  conversation,
  isActive,
  isArchiveView,
  onSelect,
  onRename,
  onPin,
  onArchive,
  onUnarchive,
}: ConversationItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        "hover:bg-muted/70",
        isActive && "bg-muted",
        className
      )}
    >
      {/* Pin indicator */}
      {conversation.isPinned && (
        <Pin className="size-3 shrink-0 text-muted-foreground" />
      )}

      {/* Title + timestamp */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-snug">
          {conversation.title}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatRelativeTime(conversation.updatedAt)}
        </div>
      </div>

      {/* Context menu (visible on hover / focus) */}
      <div
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <ConversationContextMenu
          isPinned={conversation.isPinned}
          isArchiveView={isArchiveView}
          onRename={onRename}
          onPin={onPin}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
        />
      </div>
    </div>
  );
});

ConversationItem.displayName = "ConversationItem";
