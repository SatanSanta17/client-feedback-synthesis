"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react"

import { FILE_ICONS } from "@/lib/constants/file-icons"
import { formatFileSize } from "@/lib/utils/format-file-size"
import type { SessionAttachment } from "@/lib/services/attachment-service"
import type {
  VideoListItem,
  VideoTranscriptAttachment,
  VideoUploadError,
} from "@/lib/types/video-attachment"
import { EditedBadge } from "./edited-badge"
import { TranscriptEditor } from "./transcript-editor"
import { VideoAttachmentCard } from "./video-attachment-card"

interface VideoAttachmentSectionProps {
  items: VideoListItem[]
  // PRD-032 Part 2 — when set, in-flight cards forward the sessionId so the
  // server auto-persists the transcript on response. onAutoPersisted then
  // fires (instead of onCompleted) with the saved attachment row.
  sessionId?: string
  onCompleted: (id: string, attachment: VideoTranscriptAttachment) => void
  onAutoPersisted?: (id: string, attachment: SessionAttachment) => void
  // PRD-032 Part 3 — pre-save edit on a completed transcript. Mutates the
  // pending videoItem's parsed_content + sets is_edited = true; the flag
  // rides along on the upload payload at session-save time.
  onEdited?: (id: string, parsedContent: string) => void
  onError: (id: string, error: VideoUploadError) => void
  onRemove: (id: string) => void
}

export function VideoAttachmentSection({
  items,
  sessionId,
  onCompleted,
  onAutoPersisted,
  onEdited,
  onError,
  onRemove,
}: VideoAttachmentSectionProps) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        if (item.status === "in_flight") {
          return (
            <VideoAttachmentCard
              key={item.id}
              file={item.file}
              sessionId={sessionId}
              onCompleted={(attachment) => onCompleted(item.id, attachment)}
              onAutoPersisted={
                onAutoPersisted
                  ? (attachment) => onAutoPersisted(item.id, attachment)
                  : undefined
              }
              onError={(error) => onError(item.id, error)}
              onCancel={() => onRemove(item.id)}
            />
          )
        }
        return (
          <CompletedTranscriptCard
            key={item.id}
            attachment={item.data}
            onEdited={
              onEdited
                ? (parsedContent) => onEdited(item.id, parsedContent)
                : undefined
            }
            onRemove={() => onRemove(item.id)}
          />
        )
      })}
    </div>
  )
}

interface CompletedTranscriptCardProps {
  attachment: VideoTranscriptAttachment
  // Optional so consumers that don't want pre-save editing can skip it.
  // When absent, the Edit button is hidden.
  onEdited?: (parsedContent: string) => void
  onRemove: () => void
}

function CompletedTranscriptCard({
  attachment,
  onEdited,
  onRemove,
}: CompletedTranscriptCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const Icon = FILE_ICONS[attachment.file_type] ?? FILE_ICONS["video/mp4"]
  const showEditButton = !!onEdited && !isEditing

  return (
    <div className="rounded-md border border-border bg-muted/30">
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => !isEditing && setIsExpanded((prev) => !prev)}
          disabled={isEditing}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          aria-label={isExpanded ? "Hide transcript" : "View transcript"}
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>

        <Icon className="size-4 shrink-0 text-muted-foreground" />

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-foreground">
            {attachment.file_name}
          </span>
          <span className="text-xs text-muted-foreground/80">
            Transcript only — original video not stored
          </span>
        </div>

        <span className="shrink-0 text-xs text-muted-foreground">
          {formatFileSize(attachment.file_size)}
        </span>

        {/* PRD-032 Part 3 — pending transcripts have no last_edited_at yet
            (persistence hasn't happened); badge appears with no tooltip. */}
        {attachment.is_edited && <EditedBadge timestamp={null} />}

        {showEditButton && (
          <button
            type="button"
            onClick={() => {
              setIsEditing(true)
              setIsExpanded(false)
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Edit transcript for ${attachment.file_name}`}
          >
            <Pencil className="size-3.5" />
          </button>
        )}

        {!isEditing && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remove ${attachment.file_name}`}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {isEditing ? (
        <TranscriptEditor
          initialContent={attachment.parsed_content}
          onSave={(newContent) => {
            onEdited?.(newContent)
            setIsEditing(false)
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        isExpanded && (
          <div className="border-t border-border bg-muted/50 px-3 py-2">
            <div className="max-h-48 overflow-y-auto rounded bg-background p-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {attachment.parsed_content}
            </div>
          </div>
        )
      )}
    </div>
  )
}
