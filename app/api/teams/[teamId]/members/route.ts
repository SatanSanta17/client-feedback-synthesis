import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTeamMember, getTeamMembersWithProfiles } from "@/lib/services/team-service";

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

// ---------------------------------------------------------------------------
// GET /api/teams/[teamId]/members
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

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
  if (!member) {
    return NextResponse.json(
      { message: "You are not a member of this team" },
      { status: 403 }
    );
  }

  try {
    const members = await getTeamMembersWithProfiles(teamId);
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
