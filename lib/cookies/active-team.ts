/**
 * Client-side active team cookie helpers.
 *
 * Server-side reads use `getActiveTeamId()` from `lib/supabase/server.ts`
 * (next/headers cookies). This module handles client-side document.cookie only.
 */

const COOKIE_NAME = "active_team_id";
const COOKIE_TTL = 60 * 60 * 24 * 365; // 1 year

export function getActiveTeamId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function setActiveTeamCookie(teamId: string): void {
  document.cookie = `${COOKIE_NAME}=${teamId}; path=/; max-age=${COOKIE_TTL}; SameSite=Lax`;
}

export function clearActiveTeamCookie(): void {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}
