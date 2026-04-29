// ---------------------------------------------------------------------------
// Theme Candidate / Dismissal Types (PRD-026 Part 2)
// ---------------------------------------------------------------------------
//
// Domain types for the platform-suggested merge candidate surface.
// Snapshotted per-side stats live on the candidate row (Decision 16) — names
// and descriptions are joined from `themes` at read time so renames flow
// through without a refresh.
// ---------------------------------------------------------------------------

/** Snapshot of one side's signal-volume stats at refresh time. */
export interface ThemeSideStats {
  assignmentCount: number;
  distinctSessions: number;
  distinctClients: number;
  lastAssignedAt: string | null;
}

/** A persisted candidate pair, in the shape the service produces and stores. */
export interface ThemeCandidate {
  id: string;
  teamId: string | null;
  initiatedBy: string;
  themeAId: string;
  themeBId: string;
  similarityScore: number;
  volumeScore: number;
  recencyScore: number;
  combinedScore: number;
  themeAStats: ThemeSideStats;
  themeBStats: ThemeSideStats;
  sharedKeywords: string[];
  refreshBatchId: string;
  generatedAt: string;
}

/**
 * The shape the admin surface consumes — candidate row plus the current
 * `name` + `description` of each side. Joined at read time so renames don't
 * require a refresh.
 */
export interface ThemeCandidateWithThemes extends ThemeCandidate {
  themeA: { id: string; name: string; description: string | null };
  themeB: { id: string; name: string; description: string | null };
}

/** A recorded "not a duplicate" judgment by an admin. */
export interface ThemeDismissal {
  id: string;
  teamId: string | null;
  initiatedBy: string;
  themeAId: string;
  themeBId: string;
  dismissedBy: string;
  dismissedAt: string;
}

/** Output of the `find_theme_candidate_pairs` RPC — pre-scoring shape. */
export interface CandidatePair {
  themeAId: string;
  themeBId: string;
  similarity: number;
}
