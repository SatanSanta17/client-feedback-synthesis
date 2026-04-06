"use client"

import { MarkdownPanel } from "./markdown-panel"

interface StructuredNotesPanelProps {
  structuredNotes: string | null
  onChange: (notes: string | null) => void
}

export function StructuredNotesPanel({
  structuredNotes,
  onChange,
}: StructuredNotesPanelProps) {
  if (!structuredNotes) return null

  return (
    <div className="mt-6">
      <h3 className="mb-3 text-sm font-medium text-foreground">
        Extracted Signals
      </h3>
      <MarkdownPanel
        content={structuredNotes}
        onChange={onChange}
      />
    </div>
  )
}
