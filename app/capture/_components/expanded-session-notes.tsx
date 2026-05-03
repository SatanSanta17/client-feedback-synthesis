"use client"

import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { MAX_COMBINED_CHARS } from "@/lib/constants"
import { Label } from "@/components/ui/label"
import { MarkdownPanel } from "./markdown-panel"
import { FileUploadZone, type ParsedAttachment } from "./file-upload-zone"
import { AttachmentList } from "./attachment-list"
import { SavedAttachmentList } from "./saved-attachment-list"
import { VideoAttachmentSection } from "./video-attachment-section"
import type { SessionAttachment } from "@/lib/services/attachment-service"
import type {
  VideoListItem,
  VideoTranscriptAttachment,
  VideoUploadError,
} from "@/lib/types/video-attachment"

interface ExpandedSessionNotesProps {
  rawNotes: string
  onRawNotesChange?: (notes: string) => void
  canEdit: boolean
  sessionId: string
  savedAttachments: SessionAttachment[]
  pendingAttachments: ParsedAttachment[]
  videoItems: VideoListItem[]
  // PRD-032 Part 2 — when present, video transcripts auto-persist server-side.
  videoSessionId?: string
  isLoadingAttachments: boolean
  structuredNotes: string | null
  extractionState: "idle" | "extracting" | "done"
  isSaving: boolean
  totalChars: number
  isOverLimit: boolean
  totalAttachmentCount: number
  onSavedAttachmentDeleted: (attachmentId: string) => void
  onSavedAttachmentEdited: (attachment: SessionAttachment) => void
  onAddPendingAttachment: (attachment: ParsedAttachment) => void
  onRemovePendingAttachment: (index: number) => void
  onVideoSelected: (file: File) => void
  onVideoCompleted: (id: string, attachment: VideoTranscriptAttachment) => void
  onVideoAutoPersisted?: (id: string, attachment: SessionAttachment) => void
  onVideoEdited: (id: string, parsedContent: string) => void
  onVideoError: (id: string, error: VideoUploadError) => void
  onVideoRemove: (id: string) => void
}

export function ExpandedSessionNotes({
  rawNotes,
  onRawNotesChange,
  canEdit,
  sessionId,
  savedAttachments,
  pendingAttachments,
  videoItems,
  videoSessionId,
  isLoadingAttachments,
  structuredNotes,
  extractionState,
  isSaving,
  totalChars,
  isOverLimit,
  totalAttachmentCount,
  onSavedAttachmentDeleted,
  onSavedAttachmentEdited,
  onAddPendingAttachment,
  onRemovePendingAttachment,
  onVideoSelected,
  onVideoCompleted,
  onVideoAutoPersisted,
  onVideoEdited,
  onVideoError,
  onVideoRemove,
}: ExpandedSessionNotesProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">Raw Notes</Label>
      <MarkdownPanel
        content={rawNotes}
        onChange={canEdit ? onRawNotesChange : undefined}
        readOnly={!canEdit}
      />

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
            onEdited={onSavedAttachmentEdited}
          />
        )}

        <AttachmentList
          attachments={pendingAttachments}
          onRemove={onRemovePendingAttachment}
        />

        <VideoAttachmentSection
          items={videoItems}
          sessionId={videoSessionId}
          onCompleted={onVideoCompleted}
          onAutoPersisted={onVideoAutoPersisted}
          onEdited={onVideoEdited}
          onError={onVideoError}
          onRemove={onVideoRemove}
        />

        {canEdit && (
          <FileUploadZone
            onFileParsed={onAddPendingAttachment}
            onVideoSelected={onVideoSelected}
            disabled={isSaving || extractionState === "extracting"}
            currentCount={totalAttachmentCount}
          />
        )}

        {(savedAttachments.length > 0 ||
          pendingAttachments.length > 0 ||
          videoItems.length > 0 ||
          rawNotes.length > 0) && (
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
