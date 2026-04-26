import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTeamAdmin } from "@/lib/api/route-auth";
import { resendInvitation } from "@/lib/services/invitation-service";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";

export async function POST(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ teamId: string; invitationId: string }> }
) {
  const { teamId, invitationId } = await params;
  console.log(
    `[api/teams/${teamId}/invitations/${invitationId}/resend] POST — resending`
  );

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamAdmin(
    teamId,
    auth.user,
    "Only team admins can resend invitations"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { user, supabase, serviceClient, team } = ctx;

  const invitationRepo = createInvitationRepository(supabase, serviceClient);

  try {
    await resendInvitation(
      invitationRepo,
      teamId,
      invitationId,
      user.email ?? "Unknown",
      team.name
    );
    return NextResponse.json({ message: "Invitation resent" });
  } catch (err) {
    console.error(
      `[api/teams/${teamId}/invitations/${invitationId}/resend] POST — error:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to resend invitation" },
      { status: 500 }
    );
  }
}
