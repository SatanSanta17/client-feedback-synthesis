import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTeamAdmin } from "@/lib/api/route-auth";
import {
  createInvitations,
  getPendingInvitations,
} from "@/lib/services/invitation-service";
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

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamAdmin(
    teamId,
    auth.user,
    "Only team admins can view invitations"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, serviceClient } = ctx;

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

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireTeamAdmin(
    teamId,
    auth.user,
    "Only team admins can invite members"
  );
  if (ctx instanceof NextResponse) return ctx;
  const { user, supabase, serviceClient, team, teamRepo } = ctx;

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
