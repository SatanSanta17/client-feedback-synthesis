"use client"

import { AlertCircle, Loader2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FILE_ICONS } from "@/lib/constants/file-icons"
import { formatFileSize } from "@/lib/utils/format-file-size"
import { useVideoAttachment } from "@/lib/hooks/use-video-attachment"
import type { SessionAttachment } from "@/lib/services/attachment-service"
import type {
  VideoTranscriptAttachment,
  VideoUploadError,
  VideoUploadState,
} from "@/lib/types/video-attachment"

interface VideoAttachmentCardProps {
  file: File
  // PRD-032 Part 2 — when set, the server auto-persists the transcript and
  // calls onAutoPersisted with the saved row. Otherwise onCompleted fires.
  sessionId?: string
  onCompleted: (attachment: VideoTranscriptAttachment) => void
  onAutoPersisted?: (attachment: SessionAttachment) => void
  onError: (error: VideoUploadError) => void
  onCancel: () => void
}

export function VideoAttachmentCard({
  file,
  sessionId,
  onCompleted,
  onAutoPersisted,
  onError,
  onCancel,
}: VideoAttachmentCardProps) {
  const { state, cancel } = useVideoAttachment(file, {
    sessionId,
    onCompleted,
    onAutoPersisted,
    onError,
  })

  // Completed transitions to a different list item in the parent (the
  // pending video_transcript attachment); the card renders nothing during the
  // single-frame gap before the parent re-renders without it.
  if (state.status === "completed" || state.status === "cancelled") {
    return null
  }

  const Icon = FILE_ICONS[file.type] ?? FILE_ICONS["video/mp4"]

  const handleCancel = () => {
    cancel()
    onCancel()
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-muted/30",
        state.status === "error" ? "border-destructive/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        {state.status === "error" ? (
          <AlertCircle className="size-4 shrink-0 text-destructive" />
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground" />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {file.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatFileSize(file.size)}
            </span>
          </div>

          <StatusLine state={state} />
        </div>

        <button
          type="button"
          onClick={handleCancel}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Cancel ${file.name}`}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {state.status === "error" && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-destructive">{state.error.message}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCancel}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusLine({ state }: { state: VideoUploadState }) {
  switch (state.status) {
    case "queued":
      return (
        <p className="text-xs text-muted-foreground">Queued…</p>
      )
    case "probing":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Reading metadata…
        </p>
      )
    case "extracting":
      return (
        <ProgressLine
          label={`Processing video locally — ${Math.round(state.progress * 100)}%`}
          fraction={state.progress}
        />
      )
    case "uploading": {
      const chunkSuffix =
        state.totalChunks && state.totalChunks > 1
          ? ` (chunk ${(state.chunksDone ?? 0) + 1}/${state.totalChunks})`
          : ""
      return (
        <ProgressLine
          label={`Uploading audio — ${Math.round(state.progress * 100)}%${chunkSuffix}`}
          fraction={state.progress}
        />
      )
    }
    case "transcribing": {
      const label =
        state.totalChunks > 1
          ? `Transcribing chunk ${state.chunksDone}/${state.totalChunks}…`
          : "Transcribing…"
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {label}
        </p>
      )
    }
    case "error":
      return null
    default:
      return null
  }
}

function ProgressLine({
  label,
  fraction,
}: {
  label: string
  fraction: number
}) {
  const clamped = Math.max(0, Math.min(1, fraction))
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="h-1 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${Math.round(clamped * 100)}%` }}
        />
      </div>
    </div>
  )
}
