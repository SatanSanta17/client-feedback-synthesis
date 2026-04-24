"use client"

import { useState } from "react"
import { Eye, Pencil } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StructuredSignalView } from "@/components/capture/structured-signal-view"
import { MarkdownPanel } from "./markdown-panel"
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema"

interface StructuredNotesPanelProps {
  structuredNotes: string | null
  structuredJson?: Record<string, unknown> | null
  onChange: (notes: string | null) => void
  readOnly?: boolean
  /** Whether to show the "Extracted Signals" heading. Default true. Set false when
   *  the parent already renders its own heading (e.g. expanded session row). */
  showHeading?: boolean
  className?: string
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
  showHeading = true,
  className,
}: StructuredNotesPanelProps) {
  const [isEditing, setIsEditing] = useState(false)

  // Nothing to show if neither representation exists
  if (!structuredNotes && !structuredJson) return null

  const hasJson = structuredJson !== null && structuredJson !== undefined

  // Edit toggle button — reused in both heading and standalone positions
  const editToggle = hasJson && !readOnly ? (
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
  ) : null

  return (
    <div className={cn(showHeading ? "mt-6" : "", className)}>
      {showHeading ? (
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">
            Extracted Signals
          </h3>
          {editToggle}
        </div>
      ) : editToggle ? (
        <div className="mb-2 flex justify-end">{editToggle}</div>
      ) : null}

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
          forceEdit={hasJson && isEditing}
        />
      )}
    </div>
  )
}
