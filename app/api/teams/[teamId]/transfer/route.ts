import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getTeamById,
  getTeamMember,
  transferOwnership,
} from "@/lib/services/team-service";

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

  if (team.owner_id !== user.id) {
    return NextResponse.json(
      { message: "Only the current owner can transfer ownership" },
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

  const newOwnerMember = await getTeamMember(teamId, parsed.data.newOwnerId);
  if (!newOwnerMember) {
    return NextResponse.json(
      { message: "The target user is not an active member of this team" },
      { status: 404 }
    );
  }

  try {
    await transferOwnership(teamId, parsed.data.newOwnerId);
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
