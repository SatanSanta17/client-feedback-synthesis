import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTeamAdmin } from "@/lib/api/route-auth";
import { revokeInvitation } from "@/lib/services/invitation-service";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string; invitationId: string }> }
) {
  const { teamId, invitationId } = await params;
  console.log(
    `[api/teams/${teamId}/invitations/${invitationId}] DELETE — revoking`
  );

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamAdmin(
    teamId,
    auth.user,
    "Only team admins can revoke invitations"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, serviceClient } = ctx;

  const invitationRepo = createInvitationRepository(supabase, serviceClient);

  try {
    await revokeInvitation(invitationRepo, teamId, invitationId);
    return NextResponse.json({ message: "Invitation revoked" });
  } catch (err) {
    console.error(
      `[api/teams/${teamId}/invitations/${invitationId}] DELETE — error:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to revoke invitation" },
      { status: 500 }
    );
  }
}
