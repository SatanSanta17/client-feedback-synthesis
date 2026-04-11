"use client";

// ---------------------------------------------------------------------------
// HighlightedText — Search term highlighting (PRD-020 Part 3, Increment 3.6)
// ---------------------------------------------------------------------------
// Takes a text string and a search query. Splits the text by case-insensitive
// matches and wraps each match in a <mark> element. Used for both user message
// plain text and markdown text nodes.
// ---------------------------------------------------------------------------

import React, { memo } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HighlightedTextProps {
  /** The text to render, possibly with highlighted search matches. */
  text: string;
  /** The search query. When empty/null, renders text as-is. */
  searchQuery?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const HighlightedText = memo(function HighlightedText({
  text,
  searchQuery,
}: HighlightedTextProps) {
  if (!searchQuery || searchQuery.trim().length === 0) {
    return <>{text}</>;
  }

  // Escape regex special characters in the query
  const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  if (parts.length === 1) {
    return <>{text}</>;
  }

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="rounded-sm bg-yellow-200 px-0.5 dark:bg-yellow-700/60"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
});

HighlightedText.displayName = "HighlightedText";

// ---------------------------------------------------------------------------
// Utility: recursively highlight text nodes within React children
// ---------------------------------------------------------------------------

/**
 * Recursively processes React children, wrapping string text nodes with
 * search highlighting. Used by markdown components to highlight within
 * rendered elements (paragraphs, list items, etc.).
 */
export function highlightChildren(
  children: React.ReactNode,
  searchQuery: string | null | undefined
): React.ReactNode {
  if (!searchQuery || searchQuery.trim().length === 0) return children;

  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      return <HighlightedText text={child} searchQuery={searchQuery} />;
    }

    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
      return React.cloneElement(
        child,
        {},
        highlightChildren(child.props.children, searchQuery)
      );
    }

    return child;
  });
}
