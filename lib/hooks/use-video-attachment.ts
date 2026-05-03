"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FILE_SIZE_BYTES,
} from "@/lib/constants"
import { extractAudioFromVideo } from "@/lib/utils/video/extract-audio"
import { probeVideoMetadata } from "@/lib/utils/video/probe-video-metadata"
import { uploadAudioForTranscription } from "@/lib/utils/video/upload-audio"
import type {
  VideoTranscriptAttachment,
  VideoUploadError,
  VideoUploadState,
} from "@/lib/types/video-attachment"

export interface UseVideoAttachmentOptions {
  onCompleted: (attachment: VideoTranscriptAttachment) => void
  onError: (error: VideoUploadError) => void
}

export interface UseVideoAttachmentReturn {
  state: VideoUploadState
  cancel: () => void
}

export function useVideoAttachment(
  file: File,
  opts: UseVideoAttachmentOptions,
): UseVideoAttachmentReturn {
  const [state, setState] = useState<VideoUploadState>({ status: "queued" })
  const abortRef = useRef<AbortController>(new AbortController())
  const startedRef = useRef(false)

  // Latest-callback refs so the effect can stay keyed on `file` only —
  // prevents the cleanup from aborting mid-extraction when the parent
  // re-renders with a new opts object.
  const onCompletedRef = useRef(opts.onCompleted)
  const onErrorRef = useRef(opts.onError)
  useEffect(() => {
    onCompletedRef.current = opts.onCompleted
    onErrorRef.current = opts.onError
  })

  const cancel = useCallback(() => {
    abortRef.current.abort()
    setState({ status: "cancelled" })
  }, [])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const ctrl = abortRef.current

    const run = async () => {
      try {
        if (file.size > MAX_VIDEO_FILE_SIZE_BYTES) {
          const err: VideoUploadError = {
            code: "FILE_TOO_LARGE",
            message: "Video files must be 500 MB or smaller.",
          }
          setState({ status: "error", error: err })
          onErrorRef.current(err)
          return
        }

        setState({ status: "probing" })
        const meta = await probeVideoMetadata(file, ctrl.signal)

        if (meta.duration_seconds > MAX_VIDEO_DURATION_SECONDS) {
          const err: VideoUploadError = {
            code: "DURATION_TOO_LONG",
            message: "Video must be 2 hours or shorter.",
          }
          setState({ status: "error", error: err })
          onErrorRef.current(err)
          return
        }

        setState({ status: "extracting", progress: 0 })
        const audio = await extractAudioFromVideo(file, {
          onProgress: (p) =>
            setState((prev) =>
              prev.status === "extracting"
                ? { status: "extracting", progress: p }
                : prev,
            ),
          signal: ctrl.signal,
        })

        setState({ status: "uploading", progress: 0 })
        const result = await uploadAudioForTranscription(
          {
            audio: audio.blob,
            audioFileName: `${crypto.randomUUID()}${audio.extension}`,
            videoFileName: file.name,
            videoFileType: file.type,
            videoFileSize: file.size,
            durationSeconds: meta.duration_seconds,
          },
          {
            onUploadProgress: (p) => {
              if (p >= 1) {
                setState({ status: "transcribing" })
              } else {
                setState((prev) =>
                  prev.status === "uploading"
                    ? { status: "uploading", progress: p }
                    : prev,
                )
              }
            },
            signal: ctrl.signal,
          },
        )

        // is_edited is reserved on the type for PRD-032 P3.R7 — omitted here
        // because Part 1 has no editing surface; the optional field is the
        // placeholder, no need to populate it with a literal default.
        const completed: VideoTranscriptAttachment = {
          kind: "video_transcript",
          parsed_content: result.parsed_content,
          file_name: result.file_name,
          file_type: result.file_type,
          file_size: result.file_size,
          duration_seconds: result.duration_seconds,
          source_format: "video_transcript",
        }

        setState({ status: "completed", attachment: completed })
        onCompletedRef.current(completed)
      } catch (err) {
        if (ctrl.signal.aborted) {
          setState({ status: "cancelled" })
          return
        }
        const error = mapToVideoUploadError(err)
        setState({ status: "error", error })
        onErrorRef.current(error)
      }
    }

    void run()

    return () => {
      ctrl.abort()
    }
  }, [file])

  return { state, cancel }
}

// Heuristic refinement (PRD-032 P4.R1, P4.R2) lands in Part 4.
function mapToVideoUploadError(err: unknown): VideoUploadError {
  const message = err instanceof Error ? err.message : "Unknown error"

  if (/memory|oom|allocation/i.test(message)) {
    return {
      code: "EXTRACTION_OOM",
      message:
        "Your device couldn't process this video. Try a shorter clip or a different device.",
    }
  }
  if (/ffmpeg|exec|invalid|unsupported|codec|format/i.test(message)) {
    return {
      code: "EXTRACTION_FAILED",
      message:
        "This video format couldn't be processed. Try converting to MP4 or use a different recording.",
    }
  }
  if (/network|timed out/i.test(message)) {
    return {
      code: "UPLOAD_FAILED",
      message: "Could not upload audio for transcription. Please try again.",
    }
  }
  return {
    code: "TRANSCRIPTION_FAILED",
    message: "Could not transcribe video — please try again.",
  }
}
