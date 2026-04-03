import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTeamById,
  getTeamMember,
  removeMember,
} from "@/lib/services/team-service";

interface RouteContext {
  params: Promise<{ teamId: string; userId: string }>;
}

// ---------------------------------------------------------------------------
// DELETE /api/teams/[teamId]/members/[userId] — Remove a member
// ---------------------------------------------------------------------------

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { teamId, userId: targetUserId } = await context.params;

  console.log(
    `[api/teams/[teamId]/members/[userId]] DELETE — teamId: ${teamId}, targetUserId: ${targetUserId}`
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

  if (user.id === targetUserId) {
    return NextResponse.json(
      { message: "Use the leave endpoint to remove yourself from the team" },
      { status: 400 }
    );
  }

  const team = await getTeamById(teamId);
  if (!team) {
    return NextResponse.json(
      { message: "Team not found" },
      { status: 404 }
    );
  }

  const callerMember = await getTeamMember(teamId, user.id);
  if (!callerMember) {
    return NextResponse.json(
      { message: "You are not a member of this team" },
      { status: 403 }
    );
  }

  const targetMember = await getTeamMember(teamId, targetUserId);
  if (!targetMember) {
    return NextResponse.json(
      { message: "Member not found" },
      { status: 404 }
    );
  }

  const isOwner = team.owner_id === user.id;
  const isAdmin = callerMember.role === "admin";

  if (isOwner) {
    // Owner can remove anyone except themselves (handled above)
  } else if (isAdmin) {
    if (targetMember.role === "admin") {
      return NextResponse.json(
        { message: "Only the team owner can remove admin members" },
        { status: 403 }
      );
    }
  } else {
    return NextResponse.json(
      { message: "You do not have permission to remove members" },
      { status: 403 }
    );
  }

  try {
    await removeMember(teamId, targetUserId);
    console.log(
      `[api/teams/[teamId]/members/[userId]] DELETE — removed: ${targetUserId}`
    );
    return NextResponse.json({ message: "Member removed" });
  } catch (err) {
    console.error(
      "[api/teams/[teamId]/members/[userId]] DELETE — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to remove member" },
      { status: 500 }
    );
  }
}
