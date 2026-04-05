import { NextRequest, NextResponse } from "next/server";

import { createClient, getActiveTeamId } from "@/lib/supabase/server";
import { getTeamMember } from "@/lib/services/team-service";
import {
  deleteAttachment,
  AttachmentNotFoundError,
} from "@/lib/services/attachment-service";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  const teamId = await getActiveTeamId();

  // Verify session exists and user has write access
  const { data: session } = await supabase
    .from("sessions")
    .select("id, created_by")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single();

  if (!session) {
    return NextResponse.json(
      { message: "Session not found" },
      { status: 404 }
    );
  }

  if (teamId && session.created_by !== user.id) {
    const member = await getTeamMember(teamId, user.id);
    if (member?.role !== "admin") {
      return NextResponse.json(
        { message: "You can only delete attachments from your own sessions" },
        { status: 403 }
      );
    }
  }

  try {
    await deleteAttachment(attachmentId);

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
