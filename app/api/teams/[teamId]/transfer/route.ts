import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTeamOwner } from "@/lib/api/route-auth";
import { getTeamMember, transferOwnership } from "@/lib/services/team-service";

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

const transferOwnershipSchema = z.object({
  newOwnerId: z.string().uuid("Invalid user ID"),
});

// ---------------------------------------------------------------------------
// POST /api/teams/[teamId]/transfer — Transfer ownership (owner only)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, context: RouteContext) {
  const { teamId } = await context.params;

  console.log(`[api/teams/[teamId]/transfer] POST — teamId: ${teamId}`);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamOwner(
    teamId,
    auth.user,
    "Only the current owner can transfer ownership"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { user, teamRepo } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = transferOwnershipSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ message }, { status: 400 });
  }

  if (parsed.data.newOwnerId === user.id) {
    return NextResponse.json(
      { message: "You are already the owner" },
      { status: 400 }
    );
  }

  const newOwnerMember = await getTeamMember(teamRepo, teamId, parsed.data.newOwnerId);
  if (!newOwnerMember) {
    return NextResponse.json(
      { message: "The target user is not an active member of this team" },
      { status: 404 }
    );
  }

  try {
    await transferOwnership(teamRepo, teamId, parsed.data.newOwnerId);
    console.log(
      `[api/teams/[teamId]/transfer] POST — transferred to: ${parsed.data.newOwnerId}`
    );
    return NextResponse.json({ message: "Ownership transferred" });
  } catch (err) {
    console.error(
      "[api/teams/[teamId]/transfer] POST — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to transfer ownership" },
      { status: 500 }
    );
  }
}
