import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";
import {
  getInvitationByToken,
  signupAndAcceptInvitation,
  InvitedSignupError,
} from "@/lib/services/invitation-service";
import { passwordField } from "@/lib/schemas/password-schema";

const signupBodySchema = z.object({
  password: passwordField,
});

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid request body" },
      { status: 400 }
    );
  }

  const parsed = signupBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid password" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const adminSupabase = createServiceRoleClient();
  const invitationRepo = createInvitationRepository(supabase, adminSupabase);

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
      {
        message:
          "This invitation has expired. Ask the team admin to send a new one.",
      },
      { status: 410 }
    );
  }

  try {
    const { teamId, postAuthPath } = await signupAndAcceptInvitation(
      invitationRepo,
      adminSupabase,
      supabase,
      invitation,
      parsed.data.password
    );

    console.log(
      `[invite/signup] created user for ${invitation.email} → team ${teamId}`
    );

    const response = NextResponse.json({ teamId, postAuthPath });
    response.cookies.set("active_team_id", teamId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return response;
  } catch (err) {
    if (err instanceof InvitedSignupError && err.code === "user_already_exists") {
      return NextResponse.json(
        {
          message:
            "An account with this email already exists. Please sign in instead.",
        },
        { status: 409 }
      );
    }

    console.error(
      "[invite/signup] failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Could not complete signup. Please try again." },
      { status: 500 }
    );
  }
}
