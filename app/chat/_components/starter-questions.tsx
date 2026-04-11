"use client";

// ---------------------------------------------------------------------------
// StarterQuestions — Empty state question chips (PRD-020 Part 3, Increment 3.5)
// ---------------------------------------------------------------------------
// Displays 4 hardcoded starter questions in the empty chat state.
// On click, calls sendMessage directly with the question text.
// ---------------------------------------------------------------------------

import { MessageCircleQuestion } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STARTER_QUESTIONS = [
  "What are the top pain points mentioned across all clients?",
  "Which clients have expressed urgency in the last 30 days?",
  "Summarise the most common feature requests",
  "Are there any competitive threats mentioned recently?",
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StarterQuestionsProps {
  /** Called when a starter question chip is clicked. */
  onSendMessage: (content: string) => void;
  /** Whether sending is currently disabled (e.g., during streaming). */
  disabled?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StarterQuestions({
  onSendMessage,
  disabled = false,
  className,
}: StarterQuestionsProps) {
  return (
    <div className={cn("mt-6 grid w-full max-w-md gap-2 px-4", className)}>
      {STARTER_QUESTIONS.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onSendMessage(question)}
          disabled={disabled}
          className={cn(
            "flex items-start gap-2.5 rounded-xl border border-border/60 bg-background px-3.5 py-3",
            "text-left text-sm text-foreground transition-colors",
            "hover:border-primary/30 hover:bg-primary/5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{question}</span>
        </button>
      ))}
    </div>
  );
}
