"use client"

import { useCallback, useRef, useState, useEffect } from "react"

import { useBeforeUnloadGuard } from "@/lib/hooks/use-beforeunload-guard"
import { useWakeLock } from "@/lib/hooks/use-wake-lock"
import type { SessionAttachment } from "@/lib/services/attachment-service"
import type {
  VideoListItem,
  VideoTranscriptAttachment,
  VideoUploadError,
} from "@/lib/types/video-attachment"

export interface UseVideoItemsStateOptions {
  logPrefix: string
  // PRD-032 Part 2 — when set, the per-card pipeline sends sessionId to the
  // transcribe route, which persists the transcript server-side and returns
  // the saved row. onAutoPersisted fires with that row; the videoItem is
  // removed from the list (the parent merges into savedAttachments instead).
  sessionId?: string
  onAutoPersisted?: (attachment: SessionAttachment) => void
}

export interface UseVideoItemsStateReturn {
  videoItems: VideoListItem[]
  anyVideoInFlight: boolean
  completedTranscripts: VideoTranscriptAttachment[]
  transcriptChars: number
  // Forwarded to <VideoAttachmentSection sessionId={...}> when set.
  sessionId?: string
  handleVideoSelected: (file: File) => void
  handleVideoCompleted: (id: string, attachment: VideoTranscriptAttachment) => void
  // Pass to <VideoAttachmentSection onAutoPersisted={...}> only when sessionId
  // is also set; otherwise the auto-persist path is unreachable.
  handleVideoAutoPersisted?: (id: string, attachment: SessionAttachment) => void
  handleVideoError: (id: string, error: VideoUploadError) => void
  handleVideoRemove: (id: string) => void
  reset: () => void
}

// Owns the video-attachment state slice for any surface that hosts a
// FileUploadZone with onVideoSelected. Mounts the wake-lock and beforeunload
// guard internally so the side-effects move with the state, not duplicated
// at every call site. `logPrefix` distinguishes the two consumers in error
// telemetry without forcing the hook to know about them.
export function useVideoItemsState(
  opts: UseVideoItemsStateOptions,
): UseVideoItemsStateReturn {
  const [videoItems, setVideoItems] = useState<VideoListItem[]>([])

  const completedTranscripts = videoItems.flatMap((v) =>
    v.status === "completed" ? [v.data] : []
  )
  const anyVideoInFlight = videoItems.some((v) => v.status === "in_flight")
  const transcriptChars = completedTranscripts.reduce(
    (sum, t) => sum + t.parsed_content.length,
    0
  )

  useWakeLock(anyVideoInFlight)
  useBeforeUnloadGuard(anyVideoInFlight)

  // Latest-callback ref so handleVideoAutoPersisted's identity stays stable.
  const onAutoPersistedRef = useRef(opts.onAutoPersisted)
  useEffect(() => {
    onAutoPersistedRef.current = opts.onAutoPersisted
  })

  const logPrefix = opts.logPrefix

  const handleVideoSelected = useCallback((file: File) => {
    setVideoItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), status: "in_flight", file },
    ])
  }, [])

  const handleVideoCompleted = useCallback(
    (id: string, attachment: VideoTranscriptAttachment) => {
      setVideoItems((prev) =>
        prev.map((v) =>
          v.id === id ? { id, status: "completed", data: attachment } : v
        )
      )
    },
    []
  )

  // Auto-persist branch — server already saved the transcript. Drop the
  // videoItem entirely and forward the saved row to the parent for merge
  // into savedAttachments. Exposed only when opts.sessionId is set so the
  // section gates the corresponding prop on its presence.
  const handleVideoAutoPersisted = useCallback(
    (id: string, attachment: SessionAttachment) => {
      setVideoItems((prev) => prev.filter((v) => v.id !== id))
      onAutoPersistedRef.current?.(attachment)
    },
    []
  )

  const handleVideoError = useCallback(
    (_id: string, error: VideoUploadError) => {
      console.warn(`${logPrefix} video upload error:`, error.code, error.message)
    },
    [logPrefix]
  )

  const handleVideoRemove = useCallback((id: string) => {
    setVideoItems((prev) => prev.filter((v) => v.id !== id))
  }, [])

  const reset = useCallback(() => {
    setVideoItems([])
  }, [])

  return {
    videoItems,
    anyVideoInFlight,
    completedTranscripts,
    transcriptChars,
    sessionId: opts.sessionId,
    handleVideoSelected,
    handleVideoCompleted,
    handleVideoAutoPersisted: opts.sessionId ? handleVideoAutoPersisted : undefined,
    handleVideoError,
    handleVideoRemove,
    reset,
  }
}
