import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createTeam, getTeamsForUser } from "@/lib/services/team-service";

// --- GET /api/teams ---

export async function GET() {
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

  try {
    const teams = await getTeamsForUser();

    const { data: memberships } = await supabase
      .from("team_members")
      .select("team_id, role")
      .eq("user_id", user.id)
      .is("removed_at", null);

    const roleByTeamId = new Map(
      (memberships ?? []).map((m) => [m.team_id, m.role])
    );

    const teamsWithRoles = teams.map((t) => ({
      id: t.id,
      name: t.name,
      role: roleByTeamId.get(t.id) ?? "sales",
    }));

    return NextResponse.json({ teams: teamsWithRoles });
  } catch (err) {
    console.error(
      "[api/teams] GET — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch teams" },
      { status: 500 }
    );
  }
}

// --- POST /api/teams ---

const createTeamSchema = z.object({
  name: z
    .string()
    .min(1, "Team name is required")
    .max(100, "Team name must be 100 characters or fewer"),
});

export async function POST(request: NextRequest) {
  console.log("[api/teams] POST — creating team");

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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("can_create_team")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    console.error("[api/teams] POST — profile fetch failed:", profileError?.message);
    return NextResponse.json(
      { message: "Failed to verify permissions" },
      { status: 500 }
    );
  }

  if (!profile.can_create_team) {
    return NextResponse.json(
      { message: "Team creation is not enabled for your account" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ message }, { status: 400 });
  }

  try {
    const team = await createTeam(parsed.data.name, user.id);
    console.log(`[api/teams] POST — created team: ${team.id}`);
    return NextResponse.json({ team: { id: team.id, name: team.name } }, { status: 201 });
  } catch (err) {
    console.error(
      "[api/teams] POST — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to create team" },
      { status: 500 }
    );
  }
}
