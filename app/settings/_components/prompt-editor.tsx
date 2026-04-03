"use client";

import { cn } from "@/lib/utils";

interface PromptEditorProps {
  content: string;
  onChange: (value: string) => void;
  isLoading: boolean;
  readOnly?: boolean;
  className?: string;
}

export function PromptEditor({
  content,
  onChange,
  isLoading,
  readOnly,
  className,
}: PromptEditorProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          "min-h-0 flex-1 animate-pulse rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)]",
          className
        )}
      />
    );
  }

  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      className={cn(
        "min-h-0 w-full flex-1 resize-none rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] p-4 font-mono text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]",
        readOnly && "cursor-default bg-[var(--surface-raised)] opacity-75",
        className
      )}
      spellCheck={false}
      placeholder="Enter prompt content..."
    />
  );
}
