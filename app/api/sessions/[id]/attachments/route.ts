import { NextRequest, NextResponse } from "next/server";

import {
  uploadAndCreateAttachment,
  getAttachmentCountForSession,
  getAttachmentsBySessionId,
} from "@/lib/services/attachment-service";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_ATTACHMENTS,
  ACCEPTED_FILE_TYPES,
} from "@/lib/constants";
import { checkSessionAccess } from "@/lib/services/session-service";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getActiveTeamId } from "@/lib/cookies/active-team-server";
import { mapAccessError } from "@/lib/utils/map-access-error";
import { createAttachmentRepository } from "@/lib/repositories/supabase/supabase-attachment-repository";
import { createSessionRepository } from "@/lib/repositories/supabase/supabase-session-repository";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";

// --- GET /api/sessions/[id]/attachments ---

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  console.log("[api/sessions/[id]/attachments] GET — session:", sessionId);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return mapAccessError("unauthenticated");

  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const access = await checkSessionAccess(sessionRepo, teamRepo, sessionId, user.id, teamId);
  if (!access.allowed) return mapAccessError(access.reason);

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return mapAccessError("unauthenticated");

  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const access = await checkSessionAccess(sessionRepo, teamRepo, sessionId, user.id, teamId);
  if (!access.allowed) return mapAccessError(access.reason);

  const { userId } = access;

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

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { message: `File exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit` },
      { status: 400 }
    );
  }

  if (!ACCEPTED_FILE_TYPES[file.type]) {
    return NextResponse.json(
      { message: `Unsupported file type: ${file.type}` },
      { status: 400 }
    );
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
      userId,
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
      await sessionRepo.markStale(sessionId, userId);
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
