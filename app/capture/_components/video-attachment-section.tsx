"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, X } from "lucide-react"

import { FILE_ICONS } from "@/lib/constants/file-icons"
import { formatFileSize } from "@/lib/utils/format-file-size"
import type {
  VideoListItem,
  VideoTranscriptAttachment,
  VideoUploadError,
} from "@/lib/types/video-attachment"
import { VideoAttachmentCard } from "./video-attachment-card"

interface VideoAttachmentSectionProps {
  items: VideoListItem[]
  onCompleted: (id: string, attachment: VideoTranscriptAttachment) => void
  onError: (id: string, error: VideoUploadError) => void
  onRemove: (id: string) => void
}

export function VideoAttachmentSection({
  items,
  onCompleted,
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
              onCompleted={(attachment) => onCompleted(item.id, attachment)}
              onError={(error) => onError(item.id, error)}
              onCancel={() => onRemove(item.id)}
            />
          )
        }
        return (
          <CompletedTranscriptCard
            key={item.id}
            attachment={item.data}
            onRemove={() => onRemove(item.id)}
          />
        )
      })}
    </div>
  )
}

interface CompletedTranscriptCardProps {
  attachment: VideoTranscriptAttachment
  onRemove: () => void
}

function CompletedTranscriptCard({
  attachment,
  onRemove,
}: CompletedTranscriptCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const Icon = FILE_ICONS[attachment.file_type] ?? FILE_ICONS["video/mp4"]

  return (
    <div className="rounded-md border border-border bg-muted/30">
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
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

        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${attachment.file_name}`}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-border bg-muted/50 px-3 py-2">
          <div className="max-h-48 overflow-y-auto rounded bg-background p-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {attachment.parsed_content}
          </div>
        </div>
      )}
    </div>
  )
}
