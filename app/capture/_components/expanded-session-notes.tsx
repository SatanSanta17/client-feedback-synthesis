"use client"

import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { MAX_COMBINED_CHARS } from "@/lib/constants"
import { Label } from "@/components/ui/label"
import { MarkdownPanel } from "./markdown-panel"
import { FileUploadZone, type ParsedAttachment } from "./file-upload-zone"
import { AttachmentList } from "./attachment-list"
import { SavedAttachmentList } from "./saved-attachment-list"
import type { SessionAttachment } from "@/lib/services/attachment-service"

interface ExpandedSessionNotesProps {
  rawNotes: string
  onRawNotesChange?: (notes: string) => void
  canEdit: boolean
  sessionId: string
  savedAttachments: SessionAttachment[]
  pendingAttachments: ParsedAttachment[]
  isLoadingAttachments: boolean
  structuredNotes: string | null
  extractionState: "idle" | "extracting" | "done"
  isSaving: boolean
  totalChars: number
  isOverLimit: boolean
  totalAttachmentCount: number
  onSavedAttachmentDeleted: (attachmentId: string) => void
  onAddPendingAttachment: (attachment: ParsedAttachment) => void
  onRemovePendingAttachment: (index: number) => void
}

export function ExpandedSessionNotes({
  rawNotes,
  onRawNotesChange,
  canEdit,
  sessionId,
  savedAttachments,
  pendingAttachments,
  isLoadingAttachments,
  structuredNotes,
  extractionState,
  isSaving,
  totalChars,
  isOverLimit,
  totalAttachmentCount,
  onSavedAttachmentDeleted,
  onAddPendingAttachment,
  onRemovePendingAttachment,
}: ExpandedSessionNotesProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">Raw Notes</Label>
      <MarkdownPanel
        content={rawNotes}
        onChange={canEdit ? onRawNotesChange : undefined}
        readOnly={!canEdit}
      />

      {/* Attachments section — below raw notes */}
      <div className="mt-2 flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">Attachments</Label>

        {isLoadingAttachments ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading attachments…
          </div>
        ) : (
          <SavedAttachmentList
            attachments={savedAttachments}
            sessionId={sessionId}
            canEdit={canEdit}
            hasStructuredNotes={!!structuredNotes}
            onDeleted={onSavedAttachmentDeleted}
          />
        )}

        <AttachmentList
          attachments={pendingAttachments}
          onRemove={onRemovePendingAttachment}
        />

        {canEdit && (
          <FileUploadZone
            onFileParsed={onAddPendingAttachment}
            disabled={isSaving || extractionState === "extracting"}
            currentCount={totalAttachmentCount}
          />
        )}

        {(savedAttachments.length > 0 || pendingAttachments.length > 0 || rawNotes.length > 0) && (
          <div className="flex items-center justify-between text-xs">
            <span
              className={cn(
                "text-muted-foreground",
                isOverLimit && "font-medium text-destructive"
              )}
            >
              {totalChars.toLocaleString()} / {MAX_COMBINED_CHARS.toLocaleString()} characters
            </span>
            {isOverLimit && (
              <span className="text-destructive">
                Over limit — remove content or attachments
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
