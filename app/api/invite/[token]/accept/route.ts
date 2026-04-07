import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getInvitationByToken,
  acceptInvitation,
} from "@/lib/services/invitation-service";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { token } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceRoleClient();
  const invitationRepo = createInvitationRepository(supabase, serviceClient);

  const result = await getInvitationByToken(invitationRepo, token);

  if (!result) {
    return NextResponse.json(
      { message: "This invitation link is invalid." },
      { status: 404 }
    );
  }

  const { invitation, status } = result;

  if (status === "already_accepted") {
    return NextResponse.json(
      { message: "This invitation has already been used." },
      { status: 410 }
    );
  }

  if (status === "expired") {
    return NextResponse.json(
      { message: "This invitation has expired. Ask the team admin to send a new one." },
      { status: 410 }
    );
  }

  if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
    return NextResponse.json(
      { message: "This invitation was sent to a different email address." },
      { status: 403 }
    );
  }

  try {
    await acceptInvitation(
      invitationRepo,
      invitation.id,
      user.id,
      invitation.team_id,
      invitation.role
    );

    console.log(
      `[invite/accept] user ${user.id} accepted invite ${invitation.id} for team ${invitation.team_id}`
    );

    return NextResponse.json({
      teamId: invitation.team_id,
      teamName: invitation.team_name,
    });
  } catch (err) {
    console.error(
      "[invite/accept] acceptance failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to join team. Please try again." },
      { status: 500 }
    );
  }
}
