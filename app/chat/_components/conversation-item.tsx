"use client";

// ---------------------------------------------------------------------------
// ConversationItem — Single conversation row (PRD-020 Part 3, Increment 3.2)
// ---------------------------------------------------------------------------
// Displays truncated title, relative timestamp, pin indicator.
// Supports inline rename — clicking "Rename" in the context menu makes the
// title editable in-place. Enter saves, Escape cancels.
// ---------------------------------------------------------------------------

import { memo, useState, useRef, useEffect, useCallback } from "react";
import { Pin } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format-relative-time";
import {
  useHasUnseenCompletion,
  useIsStreaming,
} from "@/lib/streaming";
import { ConversationContextMenu } from "./conversation-context-menu";
import type { Conversation } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TITLE_LENGTH = 200;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationItemProps {
  className?: string;
  conversation: Conversation;
  isActive: boolean;
  isArchiveView: boolean;
  onSelect: () => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
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
  // -------------------------------------------------------------------------
  // Streaming-state subscription (PRD-024 P4.R1, P4.R2)
  // -------------------------------------------------------------------------
  // Both hooks use primitive selectors over the streaming store, so this
  // entry doesn't re-render on deltas in OTHER conversations.

  const isStreaming = useIsStreaming(conversation.id);
  const hasUnseenCompletion = useHasUnseenCompletion(conversation.id);
  const showDot = isStreaming || hasUnseenCompletion;

  // Cohesive screen-reader announcement (P4.R5): the dot is decorative
  // (aria-hidden); the entry's aria-label carries the state so the row
  // reads as one logical thing instead of fragmenting title + status.
  const ariaLabel = isStreaming
    ? `${conversation.title}, generating response`
    : hasUnseenCompletion
      ? `${conversation.title}, new unread response`
      : conversation.title;

  // -------------------------------------------------------------------------
  // Inline rename state
  // -------------------------------------------------------------------------

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      // Delay to allow the input to mount before focusing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  const handleStartRename = useCallback(() => {
    setEditValue(conversation.title);
    setIsEditing(true);
  }, [conversation.title]);

  const handleCancelRename = useCallback(() => {
    setIsEditing(false);
    setEditValue(conversation.title);
  }, [conversation.title]);

  const handleSaveRename = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === conversation.title) {
      handleCancelRename();
      return;
    }
    await onRename(conversation.id, trimmed);
    setIsEditing(false);
  }, [editValue, conversation.id, conversation.title, onRename, handleCancelRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSaveRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelRename();
      }
    },
    [handleSaveRename, handleCancelRename]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={isEditing ? undefined : onSelect}
      onKeyDown={(e) => {
        if (isEditing) return;
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
        <Pin className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}

      {/* Streaming / unseen-completion indicator (PRD-024 P4.R1, R2).
          Single element with conditional pulsing — when the slice transitions
          streaming → idle (with hasUnseenCompletion), the dot doesn't
          unmount/remount, it just loses animate-pulse. */}
      {showDot && (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full bg-primary",
            isStreaming && "animate-pulse"
          )}
        />
      )}

      {/* Title + timestamp */}
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveRename}
            maxLength={MAX_TITLE_LENGTH}
            className={cn(
              "w-full rounded-md border border-input bg-background px-1.5 py-0.5",
              "text-sm font-medium leading-snug",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="truncate text-sm font-medium leading-snug">
            {conversation.title}
          </div>
        )}
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatRelativeTime(conversation.updatedAt)}
        </div>
      </div>

      {/* Context menu (visible on hover / focus) */}
      {!isEditing && (
        <div
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <ConversationContextMenu
            isPinned={conversation.isPinned}
            isArchiveView={isArchiveView}
            onRename={handleStartRename}
            onPin={onPin}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
          />
        </div>
      )}
    </div>
  );
});

ConversationItem.displayName = "ConversationItem";
