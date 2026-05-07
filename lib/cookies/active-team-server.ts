import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const COOKIE_NAME = "active_team_id";
const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

const COOKIE_OPTIONS = {
  path: "/",
  maxAge: COOKIE_TTL_SECONDS,
  sameSite: "lax",
} as const;

/**
 * Server-side active team cookie reader.
 *
 * Reads the active workspace from the `active_team_id` cookie via
 * `next/headers`. Returns null for personal workspace (no cookie or
 * empty value).
 *
 * Client-side reads use `getActiveTeamId()` from
 * `lib/cookies/active-team.ts` (document.cookie).
 */
export async function getActiveTeamId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value || null;
}

/**
 * Server-side active team cookie writer (server components / actions).
 *
 * Route handlers should attach the cookie to a NextResponse instead so the
 * Set-Cookie header lands on the redirect; this helper is for contexts
 * where we don't construct a response ourselves.
 */
export async function setActiveTeamCookieServer(teamId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, teamId, COOKIE_OPTIONS);
}

/**
 * Attaches the `active_team_id` cookie to a NextResponse so the Set-Cookie
 * header lands on the redirect/JSON the route handler returns.
 */
export function setActiveTeamCookieOnResponse(
  response: NextResponse,
  teamId: string
): void {
  response.cookies.set(COOKIE_NAME, teamId, COOKIE_OPTIONS);
}
