import { NextRequest, NextResponse } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getSignedDownloadUrl,
} from "@/lib/services/attachment-service";
import { checkSessionAccess } from "@/lib/services/session-service";
import { mapAccessError } from "@/lib/utils/map-access-error";
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

  const supabase = await createClient();
  const access = await checkSessionAccess(supabase, sessionId);
  if (!access.allowed) return mapAccessError(access.reason);

  const serviceClient = createServiceRoleClient();
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
