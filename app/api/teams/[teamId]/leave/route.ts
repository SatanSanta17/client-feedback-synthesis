import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTeamMember } from "@/lib/api/route-auth";
import { leaveTeam, LeaveBlockedError } from "@/lib/services/team-service";

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

// ---------------------------------------------------------------------------
// POST /api/teams/[teamId]/leave — Current user leaves the team
// ---------------------------------------------------------------------------

export async function POST(_request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  console.log(`[api/teams/[teamId]/leave] POST — teamId: ${teamId}`);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamMember(
    teamId,
    auth.user,
    "You are not a member of this team"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { user, team, teamRepo } = ctx;

  const isOwner = team.owner_id === user.id;

  try {
    const result = await leaveTeam(teamRepo, teamId, user.id, isOwner);

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
