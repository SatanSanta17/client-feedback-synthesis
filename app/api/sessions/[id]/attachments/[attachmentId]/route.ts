import { NextRequest, NextResponse } from "next/server";

import {
  deleteAttachment,
  AttachmentNotFoundError,
} from "@/lib/services/attachment-service";
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
