// ---------------------------------------------------------------------------
// Theme Dismissal Repository Interface (PRD-026 Part 2)
// ---------------------------------------------------------------------------
//
// Records "not a duplicate" judgments against candidate pairs. The service's
// refresh loop reads `listPairKeysByWorkspace` to filter dismissed pairs out
// of the next persisted candidate set (Decision 17).
// ---------------------------------------------------------------------------

export interface ThemeDismissalInsert {
  team_id: string | null;
  initiated_by: string;
  theme_a_id: string;
  theme_b_id: string;
  dismissed_by: string;
}

export interface ThemeDismissalRepository {
  /**
   * Record the dismissal. Idempotent — the unique-pair index on
   * `theme_merge_dismissals` catches re-dismissals as a constraint
   * violation, which the adapter swallows gracefully.
   */
  create(input: ThemeDismissalInsert): Promise<void>;

  /**
   * Returns the set of dismissed pairs for the workspace as a `Set` keyed on
   * `${theme_a_id}::${theme_b_id}` (lower id first per Decision 11). The
   * service uses this for an in-memory filter during refresh — one round
   * trip instead of N queries.
   */
  listPairKeysByWorkspace(
    teamId: string | null,
    userId: string
  ): Promise<Set<string>>;
}

/**
 * Canonical key for a dismissal/candidate pair lookup. Always orders the two
 * theme IDs ascending so callers don't have to remember the convention; the
 * DB CHECK constraint enforces the same ordering on persisted rows.
 */
export function pairKey(themeAId: string, themeBId: string): string {
  return themeAId < themeBId
    ? `${themeAId}::${themeBId}`
    : `${themeBId}::${themeAId}`;
}
