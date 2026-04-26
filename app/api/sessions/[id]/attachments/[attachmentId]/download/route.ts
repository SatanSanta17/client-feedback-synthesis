import { NextRequest, NextResponse } from "next/server";

import { requireAuth, requireSessionAccess } from "@/lib/api/route-auth";
import { getSignedDownloadUrl } from "@/lib/services/attachment-service";
import { createAttachmentRepository } from "@/lib/repositories/supabase/supabase-attachment-repository";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: sessionId, attachmentId } = await params;

  console.log(
    "[api/sessions/[id]/attachments/[attachmentId]/download] GET — session:",
    sessionId,
    "attachment:",
    attachmentId
  );

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireSessionAccess(sessionId, auth.user);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, serviceClient } = ctx;

  const attachmentRepo = createAttachmentRepository(supabase, serviceClient);

  const storagePath = await attachmentRepo.getStoragePath(attachmentId);

  if (!storagePath) {
    return NextResponse.json(
      { message: "Attachment not found" },
      { status: 404 }
    );
  }

  try {
    const url = await getSignedDownloadUrl(attachmentRepo, storagePath);

    console.log(
      "[api/sessions/[id]/attachments/[attachmentId]/download] GET — signed URL generated"
    );
    return NextResponse.json({ url });
  } catch (err) {
    console.error(
      "[api/sessions/[id]/attachments/[attachmentId]/download] GET error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Original file no longer available" },
      { status: 500 }
    );
  }
}
