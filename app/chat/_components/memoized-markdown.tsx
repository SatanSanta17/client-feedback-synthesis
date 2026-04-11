"use client";

// ---------------------------------------------------------------------------
// MemoizedMarkdown — React.memo wrapped ReactMarkdown (PRD-020 Part 3)
// ---------------------------------------------------------------------------
// Prevents re-rendering completed messages when new streaming deltas arrive.
// Only the actively-streaming message re-renders; all completed messages above
// it are memoized via content equality check.
// ---------------------------------------------------------------------------

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shared prose classes for consistent markdown styling across the chat. */
export const PROSE_CLASSES = cn(
  "prose prose-sm max-w-none dark:prose-invert",
  "prose-p:my-1.5 prose-p:leading-relaxed",
  "prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold",
  "prose-ul:my-1.5 prose-ol:my-1.5",
  "prose-li:my-0.5",
  "prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-muted prose-pre:p-3",
  "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.8em] prose-code:before:content-none prose-code:after:content-none",
  "prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-4 prose-blockquote:italic",
  "prose-table:my-2 prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-1.5 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-1.5",
  "prose-a:text-primary prose-a:underline prose-a:underline-offset-2",
  "prose-img:rounded-lg"
);

/** Stable array reference to avoid re-creating on every render. */
const REMARK_PLUGINS = [remarkGfm];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MemoizedMarkdownProps {
  content: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function MarkdownRenderer({ content, className }: MemoizedMarkdownProps) {
  return (
    <div className={cn(PROSE_CLASSES, className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{content}</ReactMarkdown>
    </div>
  );
}

/**
 * Memoized markdown renderer. Only re-renders when the `content` string changes.
 * Use for completed messages — streaming messages should use the unwrapped
 * renderer or accept the re-render cost.
 */
export const MemoizedMarkdown = React.memo(
  MarkdownRenderer,
  (prev, next) => prev.content === next.content && prev.className === next.className
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";
