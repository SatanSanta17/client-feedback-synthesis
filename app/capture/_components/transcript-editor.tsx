"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface TranscriptEditorProps {
  initialContent: string
  onSave: (newContent: string) => void | Promise<void>
  onCancel: () => void
  isSaving?: boolean
}

// PRD-032 Part 3 — shared inline editor used by both the saved-transcript
// path (in saved-attachment-list.tsx → PATCH endpoint) and the pending-
// transcript path (in video-attachment-section.tsx → client-state mutation).
// The component owns only its in-edit text; save/cancel decisions belong to
// the parent. P4.R6 (empty-edit rejection) is enforced inline — Save is
// disabled and the verbatim message renders below the textarea.
export function TranscriptEditor({
  initialContent,
  onSave,
  onCancel,
  isSaving = false,
}: TranscriptEditorProps) {
  const [content, setContent] = useState(initialContent)
  const isEmpty = content.trim().length === 0
  const isUnchanged = content === initialContent
  const canSave = !isEmpty && !isUnchanged && !isSaving

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-muted/50 px-3 py-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        className="resize-y font-mono text-xs"
        autoFocus
        disabled={isSaving}
        aria-label="Edit transcript"
      />
      {isEmpty && (
        <p className="text-xs text-destructive">
          Transcript can&apos;t be empty. Use Remove if you want to discard this
          attachment.
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onSave(content)}
          disabled={!canSave}
        >
          {isSaving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  )
}
