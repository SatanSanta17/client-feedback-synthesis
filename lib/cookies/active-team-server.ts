import { cookies } from "next/headers";

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
  return cookieStore.get("active_team_id")?.value || null;
}
