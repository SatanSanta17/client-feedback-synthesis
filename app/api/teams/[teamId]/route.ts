import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getTeamById,
  getTeamMember,
  renameTeam,
  deleteTeam,
} from "@/lib/services/team-service";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

// ---------------------------------------------------------------------------
// GET /api/teams/[teamId]
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  console.log(`[api/teams/[teamId]] GET — teamId: ${teamId}`);

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

  const serviceClient = createServiceRoleClient();
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const member = await getTeamMember(teamRepo, teamId, user.id);
  if (!member) {
    return NextResponse.json(
      { message: "You are not a member of this team" },
      { status: 403 }
    );
  }

  const team = await getTeamById(teamRepo, teamId);
  if (!team) {
    return NextResponse.json(
      { message: "Team not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    team: {
      id: team.id,
      name: team.name,
      owner_id: team.owner_id,
      created_at: team.created_at,
    },
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/teams/[teamId] — Rename (owner only)
// ---------------------------------------------------------------------------

const renameTeamSchema = z.object({
  name: z
    .string()
    .min(1, "Team name is required")
    .max(100, "Team name must be 100 characters or fewer"),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  console.log(`[api/teams/[teamId]] PATCH — teamId: ${teamId}`);

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

  const serviceClient = createServiceRoleClient();
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const team = await getTeamById(teamRepo, teamId);
  if (!team) {
    return NextResponse.json(
      { message: "Team not found" },
      { status: 404 }
    );
  }

  if (team.owner_id !== user.id) {
    return NextResponse.json(
      { message: "Only the team owner can rename the team" },
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

  const parsed = renameTeamSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ message }, { status: 400 });
  }

  try {
    const updated = await renameTeam(teamRepo, teamId, parsed.data.name);
    console.log(`[api/teams/[teamId]] PATCH — renamed to: ${updated.name}`);
    return NextResponse.json({
      team: { id: updated.id, name: updated.name },
    });
  } catch (err) {
    console.error(
      "[api/teams/[teamId]] PATCH — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to rename team" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/teams/[teamId] — Soft-delete (owner only)
// ---------------------------------------------------------------------------

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  console.log(`[api/teams/[teamId]] DELETE — teamId: ${teamId}`);

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

  const serviceClient = createServiceRoleClient();
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const team = await getTeamById(teamRepo, teamId);
  if (!team) {
    return NextResponse.json(
      { message: "Team not found" },
      { status: 404 }
    );
  }

  if (team.owner_id !== user.id) {
    return NextResponse.json(
      { message: "Only the team owner can delete the team" },
      { status: 403 }
    );
  }

  try {
    await deleteTeam(teamRepo, teamId);
    console.log(`[api/teams/[teamId]] DELETE — deleted: ${teamId}`);
    return NextResponse.json({ message: "Team deleted" });
  } catch (err) {
    console.error(
      "[api/teams/[teamId]] DELETE — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to delete team" },
      { status: 500 }
    );
  }
}
