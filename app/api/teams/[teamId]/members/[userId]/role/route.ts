import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getTeamById,
  getTeamMember,
  changeMemberRole,
} from "@/lib/services/team-service";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";
import { idempotentNoOp } from "@/lib/api/route-auth";

interface RouteContext {
  params: Promise<{ teamId: string; userId: string }>;
}

const changeRoleSchema = z.object({
  role: z.enum(["admin", "sales"], {
    error: "Role must be 'admin' or 'sales'",
  }),
});

// ---------------------------------------------------------------------------
// PATCH /api/teams/[teamId]/members/[userId]/role — Change role (owner only)
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { teamId, userId: targetUserId } = await context.params;

  console.log(
    `[api/teams/[teamId]/members/[userId]/role] PATCH — teamId: ${teamId}, targetUserId: ${targetUserId}`
  );

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
      { message: "Only the team owner can change member roles" },
      { status: 403 }
    );
  }

  if (user.id === targetUserId) {
    return NextResponse.json(
      { message: "You cannot change your own role as the owner" },
      { status: 400 }
    );
  }

  const targetMember = await getTeamMember(teamRepo, teamId, targetUserId);
  if (!targetMember) {
    return NextResponse.json(
      { message: "Member not found" },
      { status: 404 }
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

  const parsed = changeRoleSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ message }, { status: 400 });
  }

  if (targetMember.role === parsed.data.role) {
    console.log(
      `[api/teams/[teamId]/members/[userId]/role] PATCH — no-op: target already has role '${targetMember.role}'`
    );
    return idempotentNoOp(
      `Member already has role '${targetMember.role}'`
    );
  }

  try {
    await changeMemberRole(teamRepo, teamId, targetUserId, parsed.data.role);
    console.log(
      `[api/teams/[teamId]/members/[userId]/role] PATCH — changed to: ${parsed.data.role}`
    );
    return NextResponse.json({ message: "Role updated" });
  } catch (err) {
    console.error(
      "[api/teams/[teamId]/members/[userId]/role] PATCH — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to change role" },
      { status: 500 }
    );
  }
}
