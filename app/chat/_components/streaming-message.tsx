"use client";

// ---------------------------------------------------------------------------
// StreamingMessage — Live streaming assistant response (PRD-020 Part 3, 3.4)
// ---------------------------------------------------------------------------
// Renders the in-progress assistant message: ephemeral status text that fades
// between states, incrementally-growing markdown, and a blinking cursor
// animation at the tail of the content.
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";
import { PROSE_CLASSES } from "./memoized-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable remark plugins array for streaming renderer. */
const REMARK_PLUGINS = [remarkGfm];

/** Shared spinner classes — extracted to avoid duplication. */
const SPINNER_CLASSES =
  "h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StreamingMessageProps {
  /** Content accumulated so far from SSE deltas. */
  content: string;
  /** Ephemeral status text ("Searching sessions…", "Analysing…", etc.). */
  statusText: string | null;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StreamingMessage({
  content,
  statusText,
  className,
}: StreamingMessageProps) {
  const hasContent = content.length > 0;
  const displayStatus = statusText ?? (!hasContent ? "Thinking…" : null);

  return (
    <div
      className={cn(
        "group/message flex w-full gap-2 px-4 py-2 justify-start",
        className
      )}
    >
      <div className="relative max-w-[85%] rounded-2xl bg-muted/70 px-4 py-2.5 text-foreground md:max-w-[75%]">
        {/* Ephemeral status text — fades between states (aria-live region) */}
        {displayStatus && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "flex items-center gap-2 text-xs text-muted-foreground transition-opacity duration-300",
              hasContent && "mb-2"
            )}
          >
            <div className={SPINNER_CLASSES} aria-hidden="true" />
            <span className="animate-pulse">{displayStatus}</span>
          </div>
        )}

        {/* Streaming markdown content */}
        {hasContent && (
          <div className="relative">
            {/* Use unwrapped ReactMarkdown (not memoized) for streaming — content
                changes every delta, memoization would add overhead not save it. */}
            <div className={PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                {content}
              </ReactMarkdown>
            </div>

            {/* Blinking cursor at the end of content */}
            <span
              className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground align-text-bottom"
              aria-hidden="true"
            />
          </div>
        )}
      </div>
    </div>
  );
}
