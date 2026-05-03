import { NextRequest, NextResponse } from "next/server";

import {
  uploadAndCreateAttachment,
  createTranscriptAttachment,
  getAttachmentCountForSession,
  getAttachmentsBySessionId,
} from "@/lib/services/attachment-service";
import { MAX_ATTACHMENTS, MAX_COMBINED_CHARS } from "@/lib/constants";
import { transcriptVideoMetadataSchema } from "@/lib/schemas/transcript-attachment";
import { requireAuth, requireSessionAccess } from "@/lib/api/route-auth";
import { validateFileUpload } from "@/lib/api/file-validation";
import { createAttachmentRepository } from "@/lib/repositories/supabase/supabase-attachment-repository";

// --- GET /api/sessions/[id]/attachments ---

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  console.log("[api/sessions/[id]/attachments] GET — session:", sessionId);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireSessionAccess(sessionId, auth.user);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, serviceClient } = ctx;

  const attachmentRepo = createAttachmentRepository(supabase, serviceClient);

  try {
    const attachments = await getAttachmentsBySessionId(attachmentRepo, sessionId);

    console.log(
      "[api/sessions/[id]/attachments] GET — returning",
      attachments.length,
      "attachments"
    );
    return NextResponse.json({ attachments });
  } catch (err) {
    console.error(
      "[api/sessions/[id]/attachments] GET error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch attachments" },
      { status: 500 }
    );
  }
}

// --- POST /api/sessions/[id]/attachments ---

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  console.log("[api/sessions/[id]/attachments] POST — session:", sessionId);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireSessionAccess(sessionId, auth.user);
  if (ctx instanceof NextResponse) return ctx;
  const { user, supabase, serviceClient, teamId, sessionRepo } = ctx;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { message: "Invalid form data" },
      { status: 400 }
    );
  }

  const sourceFormat = formData.get("source_format");
  const parsedContent = formData.get("parsed_content");

  if (typeof sourceFormat !== "string") {
    return NextResponse.json(
      { message: "source_format is required" },
      { status: 400 }
    );
  }

  if (typeof parsedContent !== "string" || !parsedContent.trim()) {
    return NextResponse.json(
      { message: "parsed_content is required" },
      { status: 400 }
    );
  }

  const attachmentRepo = createAttachmentRepository(supabase, serviceClient);

  // PRD-032 Part 2 — transcript-only path. No file Blob; metadata fields
  // describe the original video that produced this transcript.
  if (sourceFormat === "video_transcript") {
    return handleTranscriptUpload({
      sessionId,
      formData,
      parsedContent,
      teamId,
      userId: user.id,
      attachmentRepo,
      sessionRepo,
    });
  }

  // Existing parsed-file path.
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { message: "No file provided" },
      { status: 400 }
    );
  }

  const validation = validateFileUpload(file);
  if (!validation.valid) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }

  const currentCount = await getAttachmentCountForSession(attachmentRepo, sessionId);
  if (currentCount >= MAX_ATTACHMENTS) {
    return NextResponse.json(
      { message: `Maximum ${MAX_ATTACHMENTS} attachments per session` },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const attachment = await uploadAndCreateAttachment(attachmentRepo, {
      sessionId,
      userId: user.id,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      parsedContent,
      sourceFormat,
      fileBuffer: buffer,
      teamId,
    });

    // Mark session as stale after attachment added (P1.R4)
    try {
      await sessionRepo.markStale(sessionId, user.id);
    } catch (staleErr) {
      console.error(
        "[api/sessions/[id]/attachments] POST — failed to mark stale:",
        staleErr instanceof Error ? staleErr.message : staleErr
      );
    }

    console.log(
      "[api/sessions/[id]/attachments] POST — created:",
      attachment.id
    );
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    console.error(
      "[api/sessions/[id]/attachments] POST error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to upload attachment" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Transcript-only branch (PRD-032 Part 2)
// ---------------------------------------------------------------------------

interface HandleTranscriptUploadInput {
  sessionId: string;
  formData: FormData;
  parsedContent: string;
  teamId: string | null;
  userId: string;
  attachmentRepo: ReturnType<typeof createAttachmentRepository>;
  sessionRepo: { markStale: (sessionId: string, userId: string) => Promise<unknown> };
}

async function handleTranscriptUpload(input: HandleTranscriptUploadInput) {
  const { sessionId, formData, parsedContent, teamId, userId, attachmentRepo, sessionRepo } = input;

  const metadataParse = transcriptVideoMetadataSchema.safeParse({
    video_file_name: formData.get("video_file_name"),
    video_file_type: formData.get("video_file_type"),
    video_file_size: Number(formData.get("video_file_size")),
    duration_seconds: Number(formData.get("duration_seconds")),
  });

  if (!metadataParse.success) {
    const message =
      metadataParse.error.issues[0]?.message ?? "Invalid transcript metadata";
    console.warn(`[api/sessions/[id]/attachments] POST — rejected (transcript): ${message}`);
    return NextResponse.json({ message }, { status: 400 });
  }

  const meta = metadataParse.data;

  // Per-session caps. We fetch all attachments once to also compute the
  // combined-char total; counting alone wouldn't catch the limit case.
  const existing = await getAttachmentsBySessionId(attachmentRepo, sessionId);
  if (existing.length >= MAX_ATTACHMENTS) {
    return NextResponse.json(
      { message: `Maximum ${MAX_ATTACHMENTS} attachments per session` },
      { status: 400 }
    );
  }

  const combinedChars =
    existing.reduce((sum, a) => sum + a.parsed_content.length, 0) +
    parsedContent.length;
  if (combinedChars > MAX_COMBINED_CHARS) {
    return NextResponse.json(
      {
        message: `Combined input exceeds ${MAX_COMBINED_CHARS.toLocaleString()} characters`,
      },
      { status: 422 }
    );
  }

  try {
    const attachment = await createTranscriptAttachment(attachmentRepo, {
      sessionId,
      teamId,
      fileName: meta.video_file_name,
      fileType: meta.video_file_type,
      fileSize: meta.video_file_size,
      parsedContent,
    });

    try {
      await sessionRepo.markStale(sessionId, userId);
    } catch (staleErr) {
      console.error(
        "[api/sessions/[id]/attachments] POST — failed to mark stale:",
        staleErr instanceof Error ? staleErr.message : staleErr
      );
    }

    console.log(
      "[api/sessions/[id]/attachments] POST — created transcript:",
      attachment.id
    );
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    console.error(
      "[api/sessions/[id]/attachments] POST transcript error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to save transcript" },
      { status: 500 }
    );
  }
}
