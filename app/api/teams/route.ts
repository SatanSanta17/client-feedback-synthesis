import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/route-auth";
import {
  canUserCreateTeam,
  createTeam,
  getTeamsWithRolesForUser,
} from "@/lib/services/team-service";
import { createProfileRepository } from "@/lib/repositories/supabase/supabase-profile-repository";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";

// --- GET /api/teams ---

export async function GET() {
  console.log("[api/teams] GET — fetching teams for current user");

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase, serviceClient } = auth;

  const teamRepo = createTeamRepository(supabase, serviceClient);

  try {
    const teams = await getTeamsWithRolesForUser(teamRepo, user.id);
    return NextResponse.json({ teams });
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

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase, serviceClient } = auth;

  const profileRepo = createProfileRepository(supabase);
  const permission = await canUserCreateTeam(profileRepo, user.id);

  if (!permission.allowed) {
    if (permission.reason === "profile_not_found") {
      return NextResponse.json(
        { message: "Failed to verify permissions" },
        { status: 500 }
      );
    }
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

  const teamRepo = createTeamRepository(supabase, serviceClient);

  try {
    const team = await createTeam(teamRepo, parsed.data.name, user.id);
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
