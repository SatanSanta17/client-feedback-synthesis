"use client";

// ---------------------------------------------------------------------------
// FollowUpChips — Suggested follow-up questions (PRD-020 Part 3, Increment 3.5)
// ---------------------------------------------------------------------------
// Renders follow-up questions as clickable pill-shaped chips below citations.
// On click, sends the question directly via onSendFollowUp callback.
// Only shown on the latest assistant message (ephemeral from useChat).
// ---------------------------------------------------------------------------

import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FollowUpChipsProps {
  questions: string[];
  /** Called when a follow-up chip is clicked — sends the question as a message. */
  onSendFollowUp: (question: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FollowUpChips({
  questions,
  onSendFollowUp,
  className,
}: FollowUpChipsProps) {
  if (questions.length === 0) return null;

  return (
    <div className={cn("mt-2 flex flex-wrap gap-1.5", className)}>
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onSendFollowUp(question)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1",
            "text-xs text-primary transition-colors",
            "hover:border-primary/40 hover:bg-primary/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <Sparkles className="size-3 shrink-0" />
          <span className="text-left">{question}</span>
        </button>
      ))}
    </div>
  );
}
