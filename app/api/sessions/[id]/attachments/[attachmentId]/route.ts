import { NextRequest, NextResponse } from "next/server";

import {
  deleteAttachment,
  getAttachmentsBySessionId,
  updateTranscriptAttachment,
  AttachmentNotFoundError,
} from "@/lib/services/attachment-service";
import { MAX_COMBINED_CHARS } from "@/lib/constants";
import { requireAuth, requireSessionAccess } from "@/lib/api/route-auth";
import { createAttachmentRepository } from "@/lib/repositories/supabase/supabase-attachment-repository";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: sessionId, attachmentId } = await params;

  console.log(
    "[api/sessions/[id]/attachments/[attachmentId]] DELETE — session:",
    sessionId,
    "attachment:",
    attachmentId
  );

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireSessionAccess(sessionId, auth.user);
  if (ctx instanceof NextResponse) return ctx;
  const { user, supabase, serviceClient, sessionRepo } = ctx;

  const attachmentRepo = createAttachmentRepository(supabase, serviceClient);

  try {
    await deleteAttachment(attachmentRepo, attachmentId);

    // Mark session as stale after attachment removed (P1.R4)
    try {
      await sessionRepo.markStale(sessionId, user.id);
    } catch (staleErr) {
      console.error(
        "[api/sessions/[id]/attachments/[attachmentId]] DELETE — failed to mark stale:",
        staleErr instanceof Error ? staleErr.message : staleErr
      );
    }

    console.log(
      "[api/sessions/[id]/attachments/[attachmentId]] DELETE — deleted:",
      attachmentId
    );
    return NextResponse.json({ message: "Attachment deleted" });
  } catch (err) {
    if (err instanceof AttachmentNotFoundError) {
      return NextResponse.json({ message: err.message }, { status: 404 });
    }

    console.error(
      "[api/sessions/[id]/attachments/[attachmentId]] DELETE error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to delete attachment" },
      { status: 500 }
    );
  }
}

// PRD-032 Part 3 — edit a video transcript's parsed_content. Editing is
// exclusive to source_format = 'video_transcript' rows; non-transcript rows
// surface as 404 (uniform negative answer — doesn't leak whether the row
// exists vs. isn't editable).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: sessionId, attachmentId } = await params;

  console.log(
    "[api/sessions/[id]/attachments/[attachmentId]] PATCH — session:",
    sessionId,
    "attachment:",
    attachmentId
  );

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireSessionAccess(sessionId, auth.user);
  if (ctx instanceof NextResponse) return ctx;
  const { user, supabase, serviceClient, sessionRepo } = ctx;

  let body: { parsed_content?: unknown };
  try {
    body = await request.json();
  } catch {
    console.warn("[api/sessions/[id]/attachments/[attachmentId]] PATCH — rejected: invalid JSON");
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const parsedContent = body.parsed_content;
  if (typeof parsedContent !== "string") {
    console.warn("[api/sessions/[id]/attachments/[attachmentId]] PATCH — rejected: parsed_content missing");
    return NextResponse.json(
      { message: "parsed_content is required" },
      { status: 400 }
    );
  }

  // P4.R6 — empty/whitespace-only edits are rejected with the verbatim
  // message the editor renders inline. Keep server and client strings aligned.
  if (parsedContent.trim().length === 0) {
    console.warn("[api/sessions/[id]/attachments/[attachmentId]] PATCH — rejected: empty content");
    return NextResponse.json(
      {
        message:
          "Transcript can't be empty. Use Remove if you want to discard this attachment.",
      },
      { status: 400 }
    );
  }

  const attachmentRepo = createAttachmentRepository(supabase, serviceClient);

  // Pre-flight: row must exist, must be a transcript, must not push the
  // session over MAX_COMBINED_CHARS. Single fetch covers all three.
  const existing = await getAttachmentsBySessionId(attachmentRepo, sessionId);
  const target = existing.find((a) => a.id === attachmentId);

  if (!target || target.source_format !== "video_transcript") {
    console.warn(
      "[api/sessions/[id]/attachments/[attachmentId]] PATCH — rejected: not found or not a transcript"
    );
    return NextResponse.json({ message: "Transcript not found" }, { status: 404 });
  }

  const otherChars = existing.reduce(
    (sum, a) => (a.id === attachmentId ? sum : sum + a.parsed_content.length),
    0
  );
  if (otherChars + parsedContent.length > MAX_COMBINED_CHARS) {
    console.warn(
      `[api/sessions/[id]/attachments/[attachmentId]] PATCH — rejected: combined ${otherChars + parsedContent.length} chars over ${MAX_COMBINED_CHARS} limit`
    );
    return NextResponse.json(
      {
        message: `Combined input exceeds ${MAX_COMBINED_CHARS.toLocaleString()} characters`,
      },
      { status: 422 }
    );
  }

  try {
    const attachment = await updateTranscriptAttachment(
      attachmentRepo,
      attachmentId,
      parsedContent
    );

    // Mark session stale — the input has changed, downstream extractions
    // are now potentially out of date (mirrors POST attachments behaviour).
    try {
      await sessionRepo.markStale(sessionId, user.id);
    } catch (staleErr) {
      console.error(
        "[api/sessions/[id]/attachments/[attachmentId]] PATCH — failed to mark stale:",
        staleErr instanceof Error ? staleErr.message : staleErr
      );
    }

    console.log(
      "[api/sessions/[id]/attachments/[attachmentId]] PATCH — updated:",
      attachment.id
    );
    return NextResponse.json({ attachment });
  } catch (err) {
    console.error(
      "[api/sessions/[id]/attachments/[attachmentId]] PATCH error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to update transcript" },
      { status: 500 }
    );
  }
}
