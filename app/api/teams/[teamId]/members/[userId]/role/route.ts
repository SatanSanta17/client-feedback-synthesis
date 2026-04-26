import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTeamOwner } from "@/lib/api/route-auth";
import { idempotentNoOp } from "@/lib/api/idempotent-no-op";
import { getTeamMember, changeMemberRole } from "@/lib/services/team-service";

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

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamOwner(
    teamId,
    auth.user,
    "Only the team owner can change member roles"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { user, teamRepo } = ctx;

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
