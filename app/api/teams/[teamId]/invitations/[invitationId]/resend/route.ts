import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getTeamMember, getTeamById } from "@/lib/services/team-service";
import { resendInvitation } from "@/lib/services/invitation-service";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";
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

  const serviceClient = createServiceRoleClient();
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const member = await getTeamMember(teamRepo, teamId, user.id);
  if (!member || member.role !== "admin") {
    return NextResponse.json(
      { message: "Only team admins can resend invitations" },
      { status: 403 }
    );
  }

  const team = await getTeamById(teamRepo, teamId);
  if (!team) {
    return NextResponse.json(
      { message: "Team not found" },
      { status: 404 }
    );
  }

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
