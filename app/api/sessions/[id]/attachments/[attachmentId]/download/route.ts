import { NextRequest, NextResponse } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getSignedDownloadUrl,
} from "@/lib/services/attachment-service";
import { checkSessionAccess } from "@/lib/services/session-service";
import { mapAccessError } from "@/lib/utils/map-access-error";

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
