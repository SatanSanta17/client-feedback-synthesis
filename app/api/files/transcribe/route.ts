import { NextRequest, NextResponse } from "next/server"

import { requireAuth } from "@/lib/api/route-auth"
import { transcriptVideoMetadataSchema } from "@/lib/schemas/transcript-attachment"

// Server-side hard cap for the audio payload itself (post-extraction).
// Whisper's per-request ceiling is 25 MB on the OpenAI free tier; 50 MB
// gives headroom for paid plans without inviting abuse via giant uploads.
const MAX_AUDIO_BYTES = 50 * 1024 * 1024

// Endpoint contract is locked here. Part 2 of PRD-032 replaces the mock
// transcript with a real Whisper / provider-abstracted call without changing
// the route signature, request shape, or response shape.
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

  // Drain the upload — keeps the audio in memory only long enough to confirm
  // we received it, then drops it. PRD-032 P2.R3 (no retention) holds even
  // for the Part 1 stub.
  await audio.arrayBuffer()

  const mockTranscript = `[mock transcript — Whisper integration pending in Part 2 of PRD-032 — original video: ${meta.video_file_name}, ${Math.round(meta.duration_seconds)}s]`

  console.log("[api/files/transcribe] POST — returning mock transcript")

  return NextResponse.json({
    parsed_content: mockTranscript,
    file_name: meta.video_file_name,
    file_type: meta.video_file_type,
    file_size: meta.video_file_size,
    duration_seconds: meta.duration_seconds,
    source_format: "video_transcript" as const,
  })
}
