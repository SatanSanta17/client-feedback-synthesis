"use client";

// ---------------------------------------------------------------------------
// CitationChips — Source citation pills (PRD-020 Part 3, Increment 3.5)
// ---------------------------------------------------------------------------
// Renders the `sources` array as pill-shaped chips showing client name and
// formatted date. Clicking a chip opens the CitationPreviewDialog.
// Deduplicates sources by sessionId to avoid repeating the same session.
// ---------------------------------------------------------------------------

import { useState, useMemo } from "react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { CitationPreviewDialog } from "./citation-preview-dialog";
import type { ChatSource } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CitationChipsProps {
  sources: ChatSource[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSourceDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Deduplicate sources by sessionId, keeping the first occurrence. */
function deduplicateSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CitationChips({ sources, className }: CitationChipsProps) {
  const [selectedSource, setSelectedSource] = useState<ChatSource | null>(null);

  const uniqueSources = useMemo(() => deduplicateSources(sources), [sources]);

  if (uniqueSources.length === 0) return null;

  return (
    <>
      <div className={cn("mt-2 flex flex-wrap gap-1.5", className)}>
        {uniqueSources.map((source) => (
          <button
            key={source.sessionId}
            type="button"
            onClick={() => setSelectedSource(source)}
            aria-label={`View citation from ${source.clientName}, ${formatSourceDate(source.sessionDate)}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2.5 py-1",
              "text-xs text-muted-foreground transition-colors",
              "hover:border-primary/30 hover:bg-primary/5 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <FileText className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate max-w-[160px]">
              {source.clientName}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="whitespace-nowrap">
              {formatSourceDate(source.sessionDate)}
            </span>
          </button>
        ))}
      </div>

      {/* Citation preview dialog */}
      <CitationPreviewDialog
        source={selectedSource}
        open={selectedSource !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSource(null);
        }}
      />
    </>
  );
}
