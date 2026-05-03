import { NextRequest, NextResponse } from "next/server"

import { requireAuth } from "@/lib/api/route-auth"
import { transcriptVideoMetadataSchema } from "@/lib/schemas/transcript-attachment"
import {
  transcribeAudio,
  TranscriptionEmptyError,
  AIConfigError,
} from "@/lib/services/ai-service"

// Whisper's per-request hard limit is 25 MB on the OpenAI API. Reject
// anything larger before we waste a provider round-trip.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    console.warn("[api/files/transcribe] POST — rejected: invalid form data")
    return NextResponse.json({ message: "Invalid form data" }, { status: 400 })
  }

  const audio = formData.get("audio")
  if (!audio || !(audio instanceof File)) {
    console.warn("[api/files/transcribe] POST — rejected: audio missing")
    return NextResponse.json({ message: "Audio file is required" }, { status: 400 })
  }

  if (audio.size === 0) {
    console.warn("[api/files/transcribe] POST — rejected: empty audio")
    return NextResponse.json(
      { message: "Audio file is empty" },
      { status: 400 },
    )
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    console.warn(
      `[api/files/transcribe] POST — rejected: audio ${audio.size} bytes exceeds ${MAX_AUDIO_BYTES} limit`,
    )
    return NextResponse.json(
      { message: "Audio payload exceeds the per-request limit" },
      { status: 413 },
    )
  }

  const metadataParse = transcriptVideoMetadataSchema.safeParse({
    video_file_name: formData.get("video_file_name"),
    video_file_type: formData.get("video_file_type"),
    video_file_size: Number(formData.get("video_file_size")),
    duration_seconds: Number(formData.get("duration_seconds")),
  })

  if (!metadataParse.success) {
    const message =
      metadataParse.error.issues[0]?.message ?? "Invalid request metadata"
    console.warn(`[api/files/transcribe] POST — rejected: ${message}`)
    return NextResponse.json({ message }, { status: 400 })
  }

  const meta = metadataParse.data

  console.log(
    `[api/files/transcribe] POST — audio ${audio.size} bytes, video "${meta.video_file_name}" (${meta.video_file_type}, ${meta.video_file_size} bytes, ${meta.duration_seconds}s)`,
  )

  // PRD-032 P2.R3 — audio is held in memory only. The Buffer goes out of
  // scope when this handler returns; nothing is written to disk or Storage.
  const audioBuffer = Buffer.from(await audio.arrayBuffer())

  try {
    const result = await transcribeAudio(audioBuffer)

    console.log(
      `[api/files/transcribe] POST — transcribed ${result.text.length} chars in ${result.durationMs}ms (${result.modelLabel})`,
    )

    return NextResponse.json({
      parsed_content: result.text,
      file_name: meta.video_file_name,
      file_type: meta.video_file_type,
      file_size: meta.video_file_size,
      duration_seconds: meta.duration_seconds,
      source_format: "video_transcript" as const,
    })
  } catch (err) {
    if (err instanceof TranscriptionEmptyError) {
      console.warn("[api/files/transcribe] POST — rejected: empty transcript")
      return NextResponse.json({ message: err.message }, { status: 422 })
    }

    if (err instanceof AIConfigError) {
      console.error(
        "[api/files/transcribe] POST — config error:",
        err.message,
      )
      return NextResponse.json(
        { message: "Transcription service is not configured" },
        { status: 500 },
      )
    }

    // withRetry has already exhausted retries for transient errors. Anything
    // else is a non-retryable upstream provider failure.
    console.error(
      "[api/files/transcribe] POST — transcription failed:",
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json(
      { message: "Transcription failed — please try again" },
      { status: 502 },
    )
  }
}
