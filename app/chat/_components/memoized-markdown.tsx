"use client";

// ---------------------------------------------------------------------------
// MemoizedMarkdown — React.memo wrapped ReactMarkdown (PRD-020 Part 3)
// ---------------------------------------------------------------------------
// Prevents re-rendering completed messages when new streaming deltas arrive.
// Only the actively-streaming message re-renders; all completed messages above
// it are memoized via content equality check.
// Supports optional search highlighting via `searchQuery` prop.
// ---------------------------------------------------------------------------

import React, { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { highlightChildren } from "./highlighted-text";

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
  /** Optional search query for highlighting matching text. */
  searchQuery?: string | null;
  className?: string;
}

// ---------------------------------------------------------------------------
// Search-aware markdown component overrides
// ---------------------------------------------------------------------------

/**
 * Builds ReactMarkdown `components` overrides that highlight text nodes
 * matching the search query. Wraps children of text-bearing elements.
 */
function buildHighlightComponents(searchQuery: string): Components {
  const wrap = (children: React.ReactNode) =>
    highlightChildren(children, searchQuery);

  return {
    p: ({ children, ...rest }) => <p {...rest}>{wrap(children)}</p>,
    li: ({ children, ...rest }) => <li {...rest}>{wrap(children)}</li>,
    td: ({ children, ...rest }) => <td {...rest}>{wrap(children)}</td>,
    th: ({ children, ...rest }) => <th {...rest}>{wrap(children)}</th>,
    strong: ({ children, ...rest }) => (
      <strong {...rest}>{wrap(children)}</strong>
    ),
    em: ({ children, ...rest }) => <em {...rest}>{wrap(children)}</em>,
    // Don't highlight inside code blocks — preserves readability
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function MarkdownRenderer({
  content,
  searchQuery,
  className,
}: MemoizedMarkdownProps) {
  const components = useMemo(
    () =>
      searchQuery && searchQuery.trim().length > 0
        ? buildHighlightComponents(searchQuery)
        : undefined,
    [searchQuery]
  );

  return (
    <div className={cn(PROSE_CLASSES, className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Memoized markdown renderer. Only re-renders when props change.
 * Use for completed messages — streaming messages should use the unwrapped
 * renderer or accept the re-render cost.
 */
export const MemoizedMarkdown = React.memo(
  MarkdownRenderer,
  (prev, next) =>
    prev.content === next.content &&
    prev.className === next.className &&
    prev.searchQuery === next.searchQuery
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";
