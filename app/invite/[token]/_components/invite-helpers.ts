const PENDING_INVITE_COOKIE_TTL = 60 * 10; // 10 minutes
const ACTIVE_TEAM_COOKIE_TTL = 60 * 60 * 24 * 365; // 1 year

export function setInviteCookie(token: string) {
  document.cookie = `pending_invite_token=${token}; path=/; max-age=${PENDING_INVITE_COOKIE_TTL}; SameSite=Lax`;
}

export function setActiveTeamCookie(teamId: string) {
  document.cookie = `active_team_id=${teamId}; path=/; max-age=${ACTIVE_TEAM_COOKIE_TTL}; SameSite=Lax`;
}

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
