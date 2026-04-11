"use client";

// ---------------------------------------------------------------------------
// CitationPreviewDialog — Source chunk preview (PRD-020 Part 3, Increment 3.5)
// ---------------------------------------------------------------------------
// Dialog that shows the chunk text from a citation source. Displays client
// name, session date, chunk type, and the raw text excerpt. Includes a link
// to navigate to the full session detail page.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { ExternalLink, FileText, Calendar, Tag } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ChatSource } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CitationPreviewDialogProps {
  source: ChatSource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatChunkType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CitationPreviewDialog({
  source,
  open,
  onOpenChange,
}: CitationPreviewDialogProps) {
  // Do NOT early-return when source is null — Dialog must remain mounted for
  // the close animation to complete. The `open` prop controls visibility.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {source && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {source.clientName}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Citation source from {source.clientName}
              </DialogDescription>
            </DialogHeader>

            {/* Metadata */}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" aria-hidden="true" />
                {formatDate(source.sessionDate)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Tag className="size-3" aria-hidden="true" />
                {formatChunkType(source.chunkType)}
              </span>
            </div>

            {/* Chunk text */}
            <div
              className={cn(
                "mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3",
                "text-sm leading-relaxed text-foreground"
              )}
            >
              <p className="whitespace-pre-wrap">{source.chunkText}</p>
            </div>

            {/* Footer with link to session */}
            <div className="mt-2 flex justify-end">
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/sessions/${source.sessionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1.5 size-3.5" aria-hidden="true" />
                  View full session
                </Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
