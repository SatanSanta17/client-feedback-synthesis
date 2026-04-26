import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTeamMember } from "@/lib/api/route-auth";
import { getTeamMembersWithProfiles } from "@/lib/services/team-service";

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

// ---------------------------------------------------------------------------
// GET /api/teams/[teamId]/members
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  console.log(`[api/teams/[teamId]/members] GET — teamId: ${teamId}`);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamMember(
    teamId,
    auth.user,
    "You are not a member of this team"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { teamRepo } = ctx;

  try {
    const members = await getTeamMembersWithProfiles(teamRepo, teamId);
    return NextResponse.json({ members });
  } catch (err) {
    console.error(
      "[api/teams/[teamId]/members] GET — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch members" },
      { status: 500 }
    );
  }
}
