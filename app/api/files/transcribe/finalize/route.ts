import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireAuth, requireSessionAccess } from "@/lib/api/route-auth"
import { MAX_ATTACHMENTS, MAX_COMBINED_CHARS } from "@/lib/constants"
import { createAttachmentRepository } from "@/lib/repositories/supabase/supabase-attachment-repository"
import { transcriptVideoMetadataSchema } from "@/lib/schemas/transcript-attachment"
import {
  createTranscriptAttachment,
  getAttachmentsBySessionId,
} from "@/lib/services/attachment-service"

// Persist-only route. The chunked transcribe pipeline calls this once, after
// all per-chunk Whisper calls have returned and the client has stitched the
// transcripts together. No Whisper call here; the function is bounded by DB
// and Storage operations only, well inside the 60 s Hobby cap.
export const maxDuration = 60

const bodySchema = z
  .object({
    session_id: z.string().uuid(),
    parsed_content: z.string().min(1, "Transcript is empty"),
    is_edited: z.boolean().optional(),
  })
  .and(transcriptVideoMetadataSchema)

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    console.warn("[api/files/transcribe/finalize] POST — rejected: invalid JSON")
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request body"
    console.warn(`[api/files/transcribe/finalize] POST — rejected: ${message}`)
    return NextResponse.json({ message }, { status: 400 })
  }

  const data = parsed.data
  const sessionCtx = await requireSessionAccess(data.session_id, auth.user)
  if (sessionCtx instanceof NextResponse) return sessionCtx

  const repo = createAttachmentRepository(
    sessionCtx.supabase,
    sessionCtx.serviceClient,
  )

  const existing = await getAttachmentsBySessionId(repo, data.session_id)

  if (existing.length >= MAX_ATTACHMENTS) {
    console.warn(
      `[api/files/transcribe/finalize] POST — rejected: max attachments (${MAX_ATTACHMENTS}) on session ${data.session_id}`,
    )
    return NextResponse.json(
      { message: `Maximum ${MAX_ATTACHMENTS} attachments per session` },
      { status: 400 },
    )
  }

  const existingChars = existing.reduce(
    (sum, a) => sum + a.parsed_content.length,
    0,
  )
  if (existingChars + data.parsed_content.length > MAX_COMBINED_CHARS) {
    console.warn(
      `[api/files/transcribe/finalize] POST — rejected: combined ${existingChars + data.parsed_content.length} chars over ${MAX_COMBINED_CHARS} limit`,
    )
    return NextResponse.json(
      {
        message: `Combined input exceeds ${MAX_COMBINED_CHARS.toLocaleString()} characters`,
      },
      { status: 422 },
    )
  }

  console.log(
    `[api/files/transcribe/finalize] POST — session: ${data.session_id}, transcript chars: ${data.parsed_content.length}, video "${data.video_file_name}" (${data.video_file_type}, ${data.video_file_size} bytes, ${data.duration_seconds}s)${data.is_edited ? " (edited)" : ""}`,
  )

  try {
    const attachment = await createTranscriptAttachment(repo, {
      sessionId: data.session_id,
      teamId: sessionCtx.teamId,
      fileName: data.video_file_name,
      fileType: data.video_file_type,
      fileSize: data.video_file_size,
      parsedContent: data.parsed_content,
      isEdited: data.is_edited,
    })

    try {
      await sessionCtx.sessionRepo.markStale(
        data.session_id,
        sessionCtx.user.id,
      )
    } catch (staleErr) {
      // The attachment is persisted; staleness is a UX hint only. Log and
      // continue so the client gets back a successful response.
      console.error(
        "[api/files/transcribe/finalize] POST — failed to mark stale:",
        staleErr instanceof Error ? staleErr.message : staleErr,
      )
    }

    console.log(
      `[api/files/transcribe/finalize] POST — persisted attachment: ${attachment.id}`,
    )

    return NextResponse.json({
      parsed_content: data.parsed_content,
      file_name: attachment.file_name,
      file_type: attachment.file_type,
      file_size: attachment.file_size,
      duration_seconds: data.duration_seconds,
      source_format: "video_transcript" as const,
      attachment,
    })
  } catch (err) {
    console.error(
      "[api/files/transcribe/finalize] POST — persist failed:",
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json(
      { message: "Transcript was generated but failed to save — please try again" },
      { status: 500 },
    )
  }
}
