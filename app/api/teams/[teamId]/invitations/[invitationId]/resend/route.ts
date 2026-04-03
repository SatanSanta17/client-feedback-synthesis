import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTeamMember, getTeamById } from "@/lib/services/team-service";
import { resendInvitation } from "@/lib/services/invitation-service";

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

  const member = await getTeamMember(teamId, user.id);
  if (!member || member.role !== "admin") {
    return NextResponse.json(
      { message: "Only team admins can resend invitations" },
      { status: 403 }
    );
  }

  const team = await getTeamById(teamId);
  if (!team) {
    return NextResponse.json(
      { message: "Team not found" },
      { status: 404 }
    );
  }

  try {
    await resendInvitation(
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
