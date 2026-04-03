import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getTeamMember } from "@/lib/services/team-service";

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
    const serviceClient = createServiceRoleClient();

    const { data: members, error } = await serviceClient
      .from("team_members")
      .select("user_id, role, joined_at")
      .eq("team_id", teamId)
      .is("removed_at", null)
      .order("joined_at", { ascending: true });

    if (error) {
      console.error("[api/teams/[teamId]/members] GET — error:", error.message);
      return NextResponse.json(
        { message: "Failed to fetch members" },
        { status: 500 }
      );
    }

    const userIds = (members ?? []).map((m) => m.user_id);

    const { data: profiles } = await serviceClient
      .from("profiles")
      .select("id, email")
      .in("id", userIds);

    const emailByUserId = new Map(
      (profiles ?? []).map((p) => [p.id, p.email])
    );

    const result = (members ?? []).map((m) => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      email: emailByUserId.get(m.user_id) ?? "unknown",
    }));

    return NextResponse.json({ members: result });
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
