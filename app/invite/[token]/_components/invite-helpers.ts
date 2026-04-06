import { setActiveTeamCookie } from "@/lib/cookies/active-team";

const PENDING_INVITE_COOKIE_TTL = 60 * 10; // 10 minutes

export function setInviteCookie(token: string) {
  document.cookie = `pending_invite_token=${token}; path=/; max-age=${PENDING_INVITE_COOKIE_TTL}; SameSite=Lax`;
}

export { setActiveTeamCookie };

export async function acceptInviteApi(
  token: string
): Promise<{ teamId: string }> {
  const response = await fetch(`/api/invite/${token}/accept`, {
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to accept invitation");
  }

  return response.json();
}
