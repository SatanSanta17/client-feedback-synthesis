"use client";

// ---------------------------------------------------------------------------
// ConversationContextMenu — Overflow menu (PRD-020 Part 3, Increment 3.2)
// ---------------------------------------------------------------------------
// Items: Rename, Pin/Unpin, Archive/Unarchive. No Delete (PRD P3.R22).
// ---------------------------------------------------------------------------

import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationContextMenuProps {
  isPinned: boolean;
  isArchiveView: boolean;
  onRename: () => void;
  onPin: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConversationContextMenu({
  isPinned,
  isArchiveView,
  onRename,
  onPin,
  onArchive,
  onUnarchive,
}: ConversationContextMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" title="Actions">
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="size-3.5" />
          Rename
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onPin}>
          {isPinned ? (
            <>
              <PinOff className="size-3.5" />
              Unpin
            </>
          ) : (
            <>
              <Pin className="size-3.5" />
              Pin
            </>
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {isArchiveView ? (
          <DropdownMenuItem onClick={onUnarchive}>
            <ArchiveRestore className="size-3.5" />
            Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="size-3.5" />
            Archive
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
