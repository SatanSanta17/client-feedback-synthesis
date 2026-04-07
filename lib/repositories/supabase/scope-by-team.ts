// ---------------------------------------------------------------------------
// Shared helper — scopes a Supabase query by workspace (team or personal).
// ---------------------------------------------------------------------------
// Used across workspace-scoped adapters (client, session, master-signal,
// prompt) to apply the `team_id = ?` / `team_id IS NULL` filter consistently.
// ---------------------------------------------------------------------------

/**
 * Applies workspace scoping to a Supabase query builder.
 *
 * - If `teamId` is non-null, filters to rows belonging to that team.
 * - If `teamId` is null, filters to personal-workspace rows (`team_id IS NULL`).
 *
 * @returns The scoped query (same reference, mutated in-place by Supabase SDK).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are deeply generic; narrowing adds no safety here
export function scopeByTeam<T extends { eq: any; is: any }>(
  query: T,
  teamId: string | null,
): T {
  if (teamId) {
    return query.eq("team_id", teamId);
  }
  return query.is("team_id", null);
}
