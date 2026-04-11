"use client";

// ---------------------------------------------------------------------------
// ChatSearchBar — In-conversation search (PRD-020 Part 3, Increment 3.6)
// ---------------------------------------------------------------------------
// Search input with match count, up/down navigation arrows, and close button.
// Slides in below the ChatHeader when search is active.
// ---------------------------------------------------------------------------

import { useRef, useCallback, useEffect } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatSearchBarProps {
  /** The current search query. */
  query: string;
  /** Update the search query. */
  onQueryChange: (query: string) => void;
  /** Total number of messages that match. */
  matchCount: number;
  /** 0-based index of the currently focused match. */
  currentMatchIndex: number;
  /** Navigate to the previous match. */
  onPrev: () => void;
  /** Navigate to the next match. */
  onNext: () => void;
  /** Close search and clear state. */
  onClose: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatSearchBar({
  query,
  onQueryChange,
  matchCount,
  currentMatchIndex,
  onPrev,
  onNext,
  onClose,
  className,
}: ChatSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when the search bar appears
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          onPrev();
        } else {
          onNext();
        }
      }
    },
    [onClose, onPrev, onNext]
  );

  const hasQuery = query.trim().length > 0;
  const matchLabel = hasQuery
    ? matchCount > 0
      ? `${currentMatchIndex + 1} of ${matchCount}`
      : "No matches"
    : "";

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border bg-background px-3 py-1.5",
        className
      )}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search in conversation…"
        aria-label="Search in conversation"
        className={cn(
          "flex-1 bg-transparent text-sm placeholder:text-muted-foreground",
          "focus-visible:outline-none"
        )}
      />

      {/* Match count */}
      {hasQuery && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {matchLabel}
        </span>
      )}

      {/* Navigation arrows */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onPrev}
          disabled={matchCount === 0}
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNext}
          disabled={matchCount === 0}
          aria-label="Next match"
          title="Next match (Enter)"
        >
          <ChevronDown className="size-4" />
        </Button>
      </div>

      {/* Close */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label="Close search"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
