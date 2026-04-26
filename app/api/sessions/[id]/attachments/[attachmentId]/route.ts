import { NextRequest, NextResponse } from "next/server";

import {
  deleteAttachment,
  AttachmentNotFoundError,
} from "@/lib/services/attachment-service";
import { checkSessionAccess } from "@/lib/services/session-service";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getActiveTeamId } from "@/lib/cookies/active-team-server";
import { mapAccessError } from "@/lib/utils/map-access-error";
import { createAttachmentRepository } from "@/lib/repositories/supabase/supabase-attachment-repository";
import { createSessionRepository } from "@/lib/repositories/supabase/supabase-session-repository";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";

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

  if (!user) return mapAccessError("unauthenticated");

  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const access = await checkSessionAccess(sessionRepo, teamRepo, sessionId, user.id, teamId);
  if (!access.allowed) return mapAccessError(access.reason);

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
