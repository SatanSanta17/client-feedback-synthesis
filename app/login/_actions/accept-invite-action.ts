"use server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";
import {
  acceptAndActivate,
  getInvitationByToken,
} from "@/lib/services/invitation-service";
import { setActiveTeamCookieServer } from "@/lib/cookies/active-team-server";
import { parseInviteToken } from "@/lib/invite/token";

export type AcceptInviteActionResult =
  | { ok: true; postAuthPath: string }
  | {
      ok: false;
      reason:
        | "invalid_token"
        | "unauthenticated"
        | "email_mismatch"
        | "expired"
        | "already_accepted"
        | "failed";
      message: string;
    };

export async function acceptInviteAction(
  rawToken: string
): Promise<AcceptInviteActionResult> {
  const token = parseInviteToken(rawToken);
  if (!token) {
    return {
      ok: false,
      reason: "invalid_token",
      message: "This invitation link is invalid.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: "You must be signed in to accept an invitation.",
    };
  }

  const serviceClient = createServiceRoleClient();
  const repo = createInvitationRepository(supabase, serviceClient);
  const result = await getInvitationByToken(repo, token);

  if (!result) {
    return {
      ok: false,
      reason: "invalid_token",
      message: "This invitation link is invalid.",
    };
  }

  const { invitation, status } = result;

  if (status === "already_accepted") {
    return {
      ok: false,
      reason: "already_accepted",
      message: "This invitation has already been used.",
    };
  }

  if (status === "expired") {
    return {
      ok: false,
      reason: "expired",
      message:
        "This invitation has expired. Ask the team admin to send a new one.",
    };
  }

  if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
    console.warn(
      `[accept-invite-action] mismatch — user ${user.email} tried to accept invite for ${invitation.email}`
    );
    return {
      ok: false,
      reason: "email_mismatch",
      message: "This invitation was sent to a different email address.",
    };
  }

  try {
    const { teamId, postAuthPath } = await acceptAndActivate(
      repo,
      supabase,
      invitation,
      user.id
    );
    await setActiveTeamCookieServer(teamId);
    return { ok: true, postAuthPath };
  } catch (err) {
    console.error(
      "[accept-invite-action] acceptance failed:",
      err instanceof Error ? err.message : err
    );
    return {
      ok: false,
      reason: "failed",
      message: "Failed to join team. Please try again.",
    };
  }
}
