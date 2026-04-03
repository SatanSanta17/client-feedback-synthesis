import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTeamById,
  getTeamMember,
  leaveTeam,
  LeaveBlockedError,
} from "@/lib/services/team-service";

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

// ---------------------------------------------------------------------------
// POST /api/teams/[teamId]/leave — Current user leaves the team
// ---------------------------------------------------------------------------

export async function POST(_request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  console.log(`[api/teams/[teamId]/leave] POST — teamId: ${teamId}`);

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

  const team = await getTeamById(teamId);
  if (!team) {
    return NextResponse.json(
      { message: "Team not found" },
      { status: 404 }
    );
  }

  const member = await getTeamMember(teamId, user.id);
  if (!member) {
    return NextResponse.json(
      { message: "You are not a member of this team" },
      { status: 403 }
    );
  }

  const isOwner = team.owner_id === user.id;

  try {
    const result = await leaveTeam(teamId, user.id, isOwner);

    console.log(
      `[api/teams/[teamId]/leave] POST — user ${user.id} left team ${teamId}`,
      result.autoTransferredTo
        ? `(ownership transferred to ${result.autoTransferredTo})`
        : ""
    );

    return NextResponse.json({
      message: "You have left the team",
      autoTransferredTo: result.autoTransferredTo ?? null,
    });
  } catch (err) {
    if (err instanceof LeaveBlockedError) {
      return NextResponse.json(
        { message: err.message },
        { status: 400 }
      );
    }

    console.error(
      "[api/teams/[teamId]/leave] POST — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to leave team" },
      { status: 500 }
    );
  }
}
