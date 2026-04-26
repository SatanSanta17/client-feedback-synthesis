import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requireTeamMember,
  requireTeamOwner,
} from "@/lib/api/route-auth";
import { renameTeam, deleteTeam } from "@/lib/services/team-service";

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

// ---------------------------------------------------------------------------
// GET /api/teams/[teamId]
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  console.log(`[api/teams/[teamId]] GET — teamId: ${teamId}`);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamMember(
    teamId,
    auth.user,
    "You are not a member of this team"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { team } = ctx;

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

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamOwner(
    teamId,
    auth.user,
    "Only the team owner can rename the team"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { teamRepo } = ctx;

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

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamOwner(
    teamId,
    auth.user,
    "Only the team owner can delete the team"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { teamRepo } = ctx;

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
