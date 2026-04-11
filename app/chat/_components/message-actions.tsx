"use client";

// ---------------------------------------------------------------------------
// MessageActions — Hover-visible action bar (PRD-020 Part 3, Increment 3.3)
// ---------------------------------------------------------------------------
// Copy-to-clipboard button. For assistant messages copies raw markdown;
// for user messages copies plain text.
// ---------------------------------------------------------------------------

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { MessageRole } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageActionsProps {
  content: string;
  role: MessageRole;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessageActions({ content, role }: MessageActionsProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleCopy}
        title={role === "assistant" ? "Copy markdown" : "Copy text"}
      >
        <Copy className="size-3" />
      </Button>
    </div>
  );
}
