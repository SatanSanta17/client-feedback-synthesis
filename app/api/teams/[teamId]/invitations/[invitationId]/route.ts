import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTeamMember, revokeInvitation } from "@/lib/services/team-service";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string; invitationId: string }> }
) {
  const { teamId, invitationId } = await params;
  console.log(
    `[api/teams/${teamId}/invitations/${invitationId}] DELETE — revoking`
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
      { message: "Only team admins can revoke invitations" },
      { status: 403 }
    );
  }

  try {
    await revokeInvitation(teamId, invitationId);
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
