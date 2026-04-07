import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getTeamMember, getTeamById } from "@/lib/services/team-service";
import {
  createInvitations,
  getPendingInvitations,
} from "@/lib/services/invitation-service";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";

const createInvitationsSchema = z.object({
  emails: z
    .array(z.string().email("Invalid email address"))
    .min(1, "At least one email is required")
    .max(50, "Cannot invite more than 50 at once"),
  role: z.enum(["admin", "sales"], {
    error: "Role must be admin or sales",
  }),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await params;
  console.log(`[api/teams/${teamId}/invitations] GET — listing invitations`);

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
  if (!member || member.role !== "admin") {
    return NextResponse.json(
      { message: "Only team admins can view invitations" },
      { status: 403 }
    );
  }

  const invitationRepo = createInvitationRepository(supabase, serviceClient);
  const invitations = await getPendingInvitations(invitationRepo, teamId);
  return NextResponse.json({ invitations });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await params;
  console.log(`[api/teams/${teamId}/invitations] POST — creating invitations`);

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
  if (!member || member.role !== "admin") {
    return NextResponse.json(
      { message: "Only team admins can invite members" },
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = createInvitationsSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ message }, { status: 400 });
  }

  const invitationRepo = createInvitationRepository(supabase, serviceClient);

  try {
    const result = await createInvitations(
      invitationRepo,
      teamRepo,
      teamId,
      parsed.data.emails,
      parsed.data.role,
      user.id,
      user.email ?? "Unknown",
      team.name
    );

    console.log(
      `[api/teams/${teamId}/invitations] POST — sent: ${result.sent.length}, skipped: ${result.skipped.length}`
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error(
      `[api/teams/${teamId}/invitations] POST — error:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to create invitations" },
      { status: 500 }
    );
  }
}
