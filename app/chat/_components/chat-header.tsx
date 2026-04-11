"use client";

// ---------------------------------------------------------------------------
// ChatHeader — Chat area header (PRD-020 Part 3, Increment 3.3)
// ---------------------------------------------------------------------------
// Shows conversation title, sidebar collapse toggle (desktop),
// mobile sidebar trigger, and search toggle (wired in Increment 3.6).
// ---------------------------------------------------------------------------

import { PanelLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatHeaderProps {
  conversation: Conversation | null;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobileSidebar: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatHeader({
  conversation,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileSidebar,
}: ChatHeaderProps) {
  return (
    <div className="flex h-12 items-center gap-2 border-b border-border px-3">
      {/* Mobile sidebar trigger */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onOpenMobileSidebar}
        title="Open sidebar"
        className="md:hidden"
      >
        <PanelLeft className="size-4" />
      </Button>

      {/* Desktop sidebar expand (only visible when collapsed) */}
      {isSidebarCollapsed && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          title="Open sidebar"
          className="hidden md:flex"
        >
          <PanelLeft className="size-4" />
        </Button>
      )}

      {/* Conversation title */}
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
        {conversation?.title ?? "New conversation"}
      </h2>
    </div>
  );
}
