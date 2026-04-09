"use client"

import { useState } from "react"
import { Eye, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { StructuredSignalView } from "@/components/capture/structured-signal-view"
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema"
import { MarkdownPanel } from "./markdown-panel"

interface StructuredNotesPanelProps {
  structuredNotes: string | null
  structuredJson?: Record<string, unknown> | null
  onChange: (notes: string | null) => void
  readOnly?: boolean
}

/**
 * Renders the extracted signals panel. Branches between two display modes:
 *
 * 1. If `structuredJson` is available → StructuredSignalView (typed UI).
 *    An edit toggle switches to MarkdownPanel for manual markdown edits.
 * 2. If `structuredJson` is null (pre-Part 1 sessions) → MarkdownPanel fallback.
 *
 * Manual edits only update the markdown representation. The JSON column is
 * left unchanged (acceptable pre-launch — structured_notes_edited flag tracks
 * the divergence). See PRD-018 P2.R5, P2.R6.
 */
export function StructuredNotesPanel({
  structuredNotes,
  structuredJson,
  onChange,
  readOnly,
}: StructuredNotesPanelProps) {
  const [isEditing, setIsEditing] = useState(false)

  // Nothing to show if neither representation exists
  if (!structuredNotes && !structuredJson) return null

  const hasJson = structuredJson !== null

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          Extracted Signals
        </h3>

        {/* Edit toggle — only shown when JSON view is active and editing is allowed */}
        {hasJson && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing((prev) => !prev)}
            className="gap-1.5 text-xs text-muted-foreground"
          >
            {isEditing ? (
              <>
                <Eye className="size-3.5" />
                Structured View
              </>
            ) : (
              <>
                <Pencil className="size-3.5" />
                Edit Markdown
              </>
            )}
          </Button>
        )}
      </div>

      {hasJson && !isEditing ? (
        /* Primary path: render from JSON */
        <div className="rounded-lg border border-border bg-card p-4">
          <StructuredSignalView signals={structuredJson as ExtractedSignals} />
        </div>
      ) : (
        /* Fallback or edit mode: render/edit markdown */
        <MarkdownPanel
          content={structuredNotes ?? ""}
          onChange={readOnly ? undefined : (v) => onChange(v)}
          readOnly={readOnly}
        />
      )}
    </div>
  )
}
