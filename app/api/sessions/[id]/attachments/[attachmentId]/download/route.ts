import { NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getSignedDownloadUrl,
} from "@/lib/services/attachment-service";
import { checkSessionWriteAccess } from "@/app/api/sessions/_helpers";

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

  const access = await checkSessionWriteAccess(sessionId);
  if (access.error) return access.error;

  const serviceClient = createServiceRoleClient();
  const { data: attachment, error: fetchError } = await serviceClient
    .from("session_attachments")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .is("deleted_at", null)
    .single();

  if (fetchError || !attachment) {
    return NextResponse.json(
      { message: "Attachment not found" },
      { status: 404 }
    );
  }

  try {
    const url = await getSignedDownloadUrl(attachment.storage_path);

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
