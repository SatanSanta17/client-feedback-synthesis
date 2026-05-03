import { NextRequest, NextResponse } from "next/server"

import { requireAuth, requireSessionAccess } from "@/lib/api/route-auth"
import type { SessionContext } from "@/lib/api/route-auth"
import { transcriptVideoMetadataSchema } from "@/lib/schemas/transcript-attachment"
import {
  transcribeAudio,
  TranscriptionEmptyError,
  AIConfigError,
} from "@/lib/services/ai-service"
import { MAX_ATTACHMENTS, MAX_COMBINED_CHARS } from "@/lib/constants"
import {
  createTranscriptAttachment,
  getAttachmentsBySessionId,
} from "@/lib/services/attachment-service"
import { createAttachmentRepository } from "@/lib/repositories/supabase/supabase-attachment-repository"
import type { AttachmentRow } from "@/lib/repositories/attachment-repository"

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

  // PRD-032 Part 2 P2.R7 — when session_id is provided, the server persists
  // the transcript before responding. The transcript survives client
  // disconnect mid-Whisper because the DB write happens server-side.
  const sessionIdRaw = formData.get("session_id")
  const sessionId =
    typeof sessionIdRaw === "string" && sessionIdRaw.length > 0
      ? sessionIdRaw
      : null

  let sessionCtx: SessionContext | null = null
  let existingAttachments: AttachmentRow[] = []

  if (sessionId) {
    const ctx = await requireSessionAccess(sessionId, auth.user)
    if (ctx instanceof NextResponse) return ctx
    sessionCtx = ctx

    // Pre-flight attachment-count check before paying for Whisper. The
    // combined-char check has to wait — we don't know transcript length yet.
    const repo = createAttachmentRepository(ctx.supabase, ctx.serviceClient)
    existingAttachments = await getAttachmentsBySessionId(repo, sessionId)
    if (existingAttachments.length >= MAX_ATTACHMENTS) {
      console.warn(
        `[api/files/transcribe] POST — auto-persist rejected: max attachments (${MAX_ATTACHMENTS})`,
      )
      return NextResponse.json(
        { message: `Maximum ${MAX_ATTACHMENTS} attachments per session` },
        { status: 400 },
      )
    }
  }

  console.log(
    `[api/files/transcribe] POST — audio ${audio.size} bytes, video "${meta.video_file_name}" (${meta.video_file_type}, ${meta.video_file_size} bytes, ${meta.duration_seconds}s)${sessionId ? `, auto-persist session: ${sessionId}` : ""}`,
  )

  // PRD-032 P2.R3 — audio is held in memory only. The Buffer goes out of
  // scope when this handler returns; nothing is written to disk or Storage.
  const audioBuffer = Buffer.from(await audio.arrayBuffer())

  let transcribed
  try {
    transcribed = await transcribeAudio(audioBuffer)
    console.log(
      `[api/files/transcribe] POST — transcribed ${transcribed.text.length} chars in ${transcribed.durationMs}ms (${transcribed.modelLabel})`,
    )
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

  // Stateless path — no session_id provided. Return the transcript text;
  // the client will persist it on session save (Increment 2.3).
  if (!sessionId || !sessionCtx) {
    return NextResponse.json({
      parsed_content: transcribed.text,
      file_name: meta.video_file_name,
      file_type: meta.video_file_type,
      file_size: meta.video_file_size,
      duration_seconds: meta.duration_seconds,
      source_format: "video_transcript" as const,
    })
  }

  // Auto-persist path. Combined-char check now that we know transcript length.
  const existingChars = existingAttachments.reduce(
    (sum, a) => sum + a.parsed_content.length,
    0,
  )
  if (existingChars + transcribed.text.length > MAX_COMBINED_CHARS) {
    console.warn(
      `[api/files/transcribe] POST — auto-persist rejected: combined ${existingChars + transcribed.text.length} chars over ${MAX_COMBINED_CHARS} limit`,
    )
    return NextResponse.json(
      {
        message: `Combined input exceeds ${MAX_COMBINED_CHARS.toLocaleString()} characters`,
      },
      { status: 422 },
    )
  }

  try {
    const repo = createAttachmentRepository(
      sessionCtx.supabase,
      sessionCtx.serviceClient,
    )
    const attachment = await createTranscriptAttachment(repo, {
      sessionId,
      teamId: sessionCtx.teamId,
      fileName: meta.video_file_name,
      fileType: meta.video_file_type,
      fileSize: meta.video_file_size,
      parsedContent: transcribed.text,
    })

    try {
      await sessionCtx.sessionRepo.markStale(sessionId, sessionCtx.user.id)
    } catch (staleErr) {
      console.error(
        "[api/files/transcribe] POST — failed to mark stale:",
        staleErr instanceof Error ? staleErr.message : staleErr,
      )
    }

    console.log(
      `[api/files/transcribe] POST — auto-persisted attachment: ${attachment.id}`,
    )

    return NextResponse.json({
      parsed_content: transcribed.text,
      file_name: attachment.file_name,
      file_type: attachment.file_type,
      file_size: attachment.file_size,
      duration_seconds: meta.duration_seconds,
      source_format: "video_transcript" as const,
      attachment,
    })
  } catch (err) {
    // Whisper succeeded but DB persist failed. The transcript is in memory
    // but not durable. Return 500 so the client knows it didn't make it;
    // client should not retry transcription (audio is already discarded).
    console.error(
      "[api/files/transcribe] POST — auto-persist failed:",
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json(
      { message: "Transcript created but failed to save — please try again" },
      { status: 500 },
    )
  }
}
