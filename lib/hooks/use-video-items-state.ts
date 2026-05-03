"use client"

import { useCallback, useState } from "react"

import { useBeforeUnloadGuard } from "@/lib/hooks/use-beforeunload-guard"
import { useWakeLock } from "@/lib/hooks/use-wake-lock"
import type {
  VideoListItem,
  VideoTranscriptAttachment,
  VideoUploadError,
} from "@/lib/types/video-attachment"

export interface UseVideoItemsStateReturn {
  videoItems: VideoListItem[]
  anyVideoInFlight: boolean
  completedTranscripts: VideoTranscriptAttachment[]
  transcriptChars: number
  handleVideoSelected: (file: File) => void
  handleVideoCompleted: (id: string, attachment: VideoTranscriptAttachment) => void
  handleVideoError: (id: string, error: VideoUploadError) => void
  handleVideoRemove: (id: string) => void
  reset: () => void
}

// Owns the video-attachment state slice for any surface that hosts a
// FileUploadZone with onVideoSelected. Mounts the wake-lock and beforeunload
// guard internally so the side-effects move with the state, not duplicated
// at every call site. `logPrefix` distinguishes the two consumers in error
// telemetry without forcing the hook to know about them.
export function useVideoItemsState(logPrefix: string): UseVideoItemsStateReturn {
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
    handleVideoSelected,
    handleVideoCompleted,
    handleVideoError,
    handleVideoRemove,
    reset,
  }
}
