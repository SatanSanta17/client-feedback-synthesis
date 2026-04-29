// ---------------------------------------------------------------------------
// Theme Candidate Repository Interfaces (PRD-026 Part 2)
// ---------------------------------------------------------------------------
//
// Two interfaces live here:
//   - ThemeCandidateRepository      — CRUD against the persisted candidate set.
//   - ThemeCandidatePairsRepository — thin wrapper over the
//                                      `find_theme_candidate_pairs` RPC.
//
// Splitting them keeps the service's dependencies focused: refreshCandidates
// reads from one interface (the RPC) and writes to the other (the table),
// listCandidates only reads the table, dismissCandidate only writes.
// ---------------------------------------------------------------------------

import type {
  CandidatePair,
  ThemeCandidate,
  ThemeCandidateWithThemes,
} from "@/lib/types/theme-candidate";

export interface ThemeCandidateInsert {
  team_id: string | null;
  initiated_by: string;
  theme_a_id: string;
  theme_b_id: string;
  similarity_score: number;
  volume_score: number;
  recency_score: number;
  combined_score: number;
  theme_a_assignment_count: number;
  theme_a_distinct_sessions: number;
  theme_a_distinct_clients: number;
  theme_a_last_assigned_at: string | null;
  theme_b_assignment_count: number;
  theme_b_distinct_sessions: number;
  theme_b_distinct_clients: number;
  theme_b_last_assigned_at: string | null;
  shared_keywords: string[];
  refresh_batch_id: string;
}

export interface ListCandidatesOptions {
  limit: number;
  offset: number;
}

export interface ThemeCandidateRepository {
  /**
   * Bulk-insert candidate rows from a single refresh pass. The service is
   * responsible for the transactional replace flow (call `deleteByWorkspace`
   * before this in the same logical operation).
   */
  bulkCreate(rows: ThemeCandidateInsert[]): Promise<void>;

  /** Workspace-scoped delete used by the transactional replace. */
  deleteByWorkspace(teamId: string | null, userId: string): Promise<void>;

  /**
   * Read top-N candidates for a workspace, joined with `themes` for each
   * side's current name + description. Ordered by `combined_score DESC` so
   * the admin sees impact-ranked pairs first (Decision 16).
   */
  listByWorkspace(
    teamId: string | null,
    userId: string,
    options: ListCandidatesOptions
  ): Promise<ThemeCandidateWithThemes[]>;

  /** Used by the dismiss flow's "is this candidate yours?" check. */
  getById(id: string): Promise<ThemeCandidate | null>;

  /**
   * Remove a single candidate row by id (after the dismissal is recorded).
   * Future refreshes naturally exclude the dismissed pair via the dismissals
   * filter — this delete keeps the candidates surface tight in the meantime.
   */
  deleteById(id: string): Promise<void>;
}

export interface ThemeCandidatePairsRepository {
  /**
   * Returns every active-theme pair within the workspace whose embedding
   * cosine similarity meets or exceeds `threshold`. Pair ordering is
   * normalised at the RPC level (`theme_a_id < theme_b_id`).
   */
  findPairs(
    teamId: string | null,
    userId: string,
    threshold: number
  ): Promise<CandidatePair[]>;
}
