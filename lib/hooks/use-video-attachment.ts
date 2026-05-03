"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FILE_SIZE_BYTES,
} from "@/lib/constants"
import { extractAudioFromVideo } from "@/lib/utils/video/extract-audio"
import { probeVideoMetadata } from "@/lib/utils/video/probe-video-metadata"
import { uploadAudioForTranscription } from "@/lib/utils/video/upload-audio"
import type { SessionAttachment } from "@/lib/services/attachment-service"
import type {
  VideoTranscriptAttachment,
  VideoUploadError,
  VideoUploadState,
} from "@/lib/types/video-attachment"

export interface UseVideoAttachmentOptions {
  // PRD-032 Part 2 — when set, the server auto-persists the transcript and
  // the response includes a SessionAttachment row. The hook routes to
  // onAutoPersisted in that case; onCompleted otherwise.
  sessionId?: string
  onCompleted: (attachment: VideoTranscriptAttachment) => void
  onAutoPersisted?: (attachment: SessionAttachment) => void
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
  const onAutoPersistedRef = useRef(opts.onAutoPersisted)
  const onErrorRef = useRef(opts.onError)
  const sessionIdRef = useRef(opts.sessionId)
  useEffect(() => {
    onCompletedRef.current = opts.onCompleted
    onAutoPersistedRef.current = opts.onAutoPersisted
    onErrorRef.current = opts.onError
    sessionIdRef.current = opts.sessionId
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
            sessionId: sessionIdRef.current,
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

        // Server auto-persisted (sessionId path) — surface the saved row.
        // Otherwise fall back to client-held transcript (manual save flow).
        if (result.attachment && onAutoPersistedRef.current) {
          onAutoPersistedRef.current(result.attachment)
        } else {
          onCompletedRef.current(completed)
        }
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

function mapToVideoUploadError(err: unknown): VideoUploadError {
  const message = err instanceof Error ? err.message : "Unknown error"

  // PRD-032 P4.R1 — OOM detection. RangeError is the canonical JS signal for
  // memory exhaustion; ffmpeg.wasm surfaces "memory access out of bounds" as
  // a WebAssembly.RuntimeError when the WASM heap is exhausted. The
  // constructor-name string compare is used because WebAssembly.RuntimeError
  // isn't reliably exposed as a global across runtimes. Falls back to the
  // message-text regex (covers Chrome/Firefox runtime variants and older
  // ffmpeg.wasm releases).
  const isRangeError = err instanceof RangeError
  const isWasmRuntimeError =
    err instanceof Error && err.constructor.name === "RuntimeError"
  if (
    isRangeError ||
    isWasmRuntimeError ||
    /memory|oom|allocation|out of bounds|out of memory/i.test(message)
  ) {
    return {
      code: "EXTRACTION_OOM",
      message:
        "Your device couldn't process this video. Try a shorter clip or a different device.",
    }
  }

  // PRD-032 P4.R2 — codec / format / corrupt-file failures. Specific
  // ffmpeg.wasm phrases observed in production: "Invalid data found when
  // processing input", "Invalid argument", "Unable to find a suitable
  // output format". `malformed` and `could not decode` cover container-
  // corruption surfaces from the wider browser stack.
  if (
    /ffmpeg|exec|invalid (data|argument)|unsupported|codec|format|unable to find|could not decode|malformed/i.test(
      message,
    )
  ) {
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
  // Server returns the empty-transcript message verbatim from
  // TranscriptionEmptyError — match it so the user sees the same wording
  // rather than the generic fallback. Activates the EMPTY_TRANSCRIPT code
  // reserved in Part 1's VideoUploadErrorCode enum.
  if (/no speech could be transcribed/i.test(message)) {
    return {
      code: "EMPTY_TRANSCRIPT",
      message: "No speech could be transcribed from this video.",
    }
  }
  return {
    code: "TRANSCRIPTION_FAILED",
    message: "Could not transcribe video — please try again.",
  }
}
