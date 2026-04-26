import { NextRequest, NextResponse } from "next/server";

import {
  uploadAndCreateAttachment,
  getAttachmentCountForSession,
  getAttachmentsBySessionId,
} from "@/lib/services/attachment-service";
import { MAX_ATTACHMENTS } from "@/lib/constants";
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

  const file = formData.get("file");
  const parsedContent = formData.get("parsed_content");
  const sourceFormat = formData.get("source_format");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { message: "No file provided" },
      { status: 400 }
    );
  }

  if (typeof parsedContent !== "string" || !parsedContent.trim()) {
    return NextResponse.json(
      { message: "parsed_content is required" },
      { status: 400 }
    );
  }

  if (typeof sourceFormat !== "string") {
    return NextResponse.json(
      { message: "source_format is required" },
      { status: 400 }
    );
  }

  const validation = validateFileUpload(file);
  if (!validation.valid) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }

  const attachmentRepo = createAttachmentRepository(supabase, serviceClient);

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
