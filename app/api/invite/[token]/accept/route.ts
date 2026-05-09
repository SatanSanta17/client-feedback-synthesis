import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";
import {
  acceptAndActivate,
  getInvitationByToken,
} from "@/lib/services/invitation-service";
import { parseInviteToken } from "@/lib/invite/token";
import { setActiveTeamCookieOnResponse } from "@/lib/cookies/active-team-server";
import { DEFAULT_AUTH_ROUTE } from "@/lib/constants";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/invite/[token]/accept
 *
 * The invite dispatcher (`app/invite/[token]/page.tsx`) is a server component
 * and Next.js 16 forbids cookie writes from server components. So when the
 * dispatcher detects an authenticated user with a matching email, it redirects
 * here and this route handler does the acceptance + cookie write + final
 * redirect to the post-auth landing path.
 *
 * Three terminal cases:
 *  1. User is already a member of the invited team (re-click after acceptance,
 *     or admin re-invited them despite the duplicate guard) → skip the accept
 *     write, set `active_team_id`, redirect to dashboard with
 *     `?invite_outcome=already_member`.
 *  2. User is not a member + invitation is valid → accept normally, set cookie,
 *     redirect to `postAuthPath` with `?invite_outcome=joined`.
 *  3. Anything else (auth lost, invitation expired or accepted by someone else,
 *     email mismatch race) → fall back to `/invite/{token}` so the dispatcher
 *     re-renders with the correct state. No redirect loop is possible because
 *     the dispatcher will not bounce the user back here for any failure case.
 */
export async function GET(request: Request, context: RouteContext) {
  const { origin } = new URL(request.url);
  const { token: rawToken } = await context.params;
  const token = parseInviteToken(rawToken);

  const fallback = NextResponse.redirect(`${origin}/invite/${rawToken}`);

  if (!token) return fallback;

  const supabase = await createClient();
  const serviceClient = createServiceRoleClient();
  const repo = createInvitationRepository(supabase, serviceClient);

  const result = await getInvitationByToken(repo, token);
  if (!result) return fallback;

  const { invitation } = result;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fallback;

  if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return fallback;
  }

  // Already a member → silent join + flash. Bypasses the invitation status
  // check intentionally: re-clicking an accepted/expired invite when you're
  // already in the team should still take you to the team.
  const isAlreadyMember = await repo.isUserTeamMember(invitation.team_id, user.id);

  if (isAlreadyMember) {
    const response = NextResponse.redirect(
      `${origin}${DEFAULT_AUTH_ROUTE}?invite_outcome=already_member`
    );
    setActiveTeamCookieOnResponse(response, invitation.team_id);

    console.log(
      `[invite/accept] user ${user.id} already member of team ${invitation.team_id}, switching workspace`
    );

    return response;
  }

  // Not a member yet — only proceed if the invitation is still valid.
  if (result.status !== "valid") return fallback;

  try {
    const { teamId, postAuthPath } = await acceptAndActivate(
      repo,
      serviceClient,
      invitation,
      user.id
    );
    const response = NextResponse.redirect(
      `${origin}${postAuthPath}?invite_outcome=joined`
    );
    setActiveTeamCookieOnResponse(response, teamId);

    console.log(
      `[invite/accept] user ${user.id} → team ${teamId} (postAuthPath ${postAuthPath})`
    );

    return response;
  } catch (err) {
    console.error(
      "[invite/accept] acceptance failed:",
      err instanceof Error ? err.message : err
    );
    return fallback;
  }
}
