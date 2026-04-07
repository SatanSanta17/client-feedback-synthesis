import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getInvitationByToken,
  acceptInvitation,
} from "@/lib/services/invitation-service";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    console.error("Auth callback: missing code parameter");
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error("Auth callback: code exchange failed", exchangeError.message);
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  // Recovery flow — redirect to reset password page, skip invite handling
  const type = searchParams.get("type");
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  const pendingToken = getCookie(request, "pending_invite_token");
  const response = NextResponse.redirect(`${origin}/capture`);

  // Always clear the invite cookie regardless of outcome
  if (pendingToken) {
    response.cookies.set("pending_invite_token", "", {
      path: "/",
      maxAge: 0,
    });
  }

  if (!pendingToken) {
    return response;
  }

  try {
    const serviceClient = createServiceRoleClient();
    const invitationRepo = createInvitationRepository(supabase, serviceClient);

    const result = await getInvitationByToken(invitationRepo, pendingToken);

    if (!result || result.status !== "valid") {
      console.log("Auth callback: invite token invalid or expired, skipping acceptance");
      return response;
    }

    const { invitation } = result;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("Auth callback: no user after session exchange");
      return response;
    }

    if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      console.warn(
        `Auth callback: email mismatch — user ${user.email} tried to accept invite for ${invitation.email}`
      );
      const mismatchRedirect = NextResponse.redirect(
        `${origin}/invite/${pendingToken}?error=email_mismatch`
      );
      mismatchRedirect.cookies.set("pending_invite_token", "", {
        path: "/",
        maxAge: 0,
      });
      return mismatchRedirect;
    }

    await acceptInvitation(
      invitationRepo,
      invitation.id,
      user.id,
      invitation.team_id,
      invitation.role
    );

    response.cookies.set("active_team_id", invitation.team_id, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });

    console.log(
      `Auth callback: user ${user.id} joined team ${invitation.team_id} via invite`
    );
  } catch (err) {
    console.error(
      "Auth callback: invite acceptance failed",
      err instanceof Error ? err.message : err
    );
  }

  return response;
}

function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}
