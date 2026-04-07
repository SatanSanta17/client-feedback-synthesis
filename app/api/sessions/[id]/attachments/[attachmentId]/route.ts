import { NextRequest, NextResponse } from "next/server";

import {
  deleteAttachment,
  AttachmentNotFoundError,
} from "@/lib/services/attachment-service";
import { checkSessionAccess } from "@/lib/services/session-service";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { mapAccessError } from "@/lib/utils/map-access-error";
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

  const supabase = await createClient();
  const access = await checkSessionAccess(supabase, sessionId);
  if (!access.allowed) return mapAccessError(access.reason);

  const serviceClient = createServiceRoleClient();
  const attachmentRepo = createAttachmentRepository(supabase, serviceClient);

  try {
    await deleteAttachment(attachmentRepo, attachmentId);

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
