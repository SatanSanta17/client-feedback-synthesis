import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  CandidatePair,
  ThemeCandidate,
  ThemeCandidateWithThemes,
  ThemeSideStats,
} from "@/lib/types/theme-candidate";

import type {
  ListCandidatesOptions,
  ThemeCandidateInsert,
  ThemeCandidatePairsRepository,
  ThemeCandidateRepository,
} from "../theme-candidate-repository";
import { scopeByTeam } from "./scope-by-team";

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const LOG = "[supabase-theme-candidate-repo]";

const COLUMNS = `
  id, team_id, initiated_by, theme_a_id, theme_b_id,
  similarity_score, volume_score, recency_score, combined_score,
  theme_a_assignment_count, theme_a_distinct_sessions, theme_a_distinct_clients, theme_a_last_assigned_at,
  theme_b_assignment_count, theme_b_distinct_sessions, theme_b_distinct_clients, theme_b_last_assigned_at,
  shared_keywords, refresh_batch_id, generated_at
`;

interface CandidateRow {
  id: string;
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
  shared_keywords: string[] | null;
  refresh_batch_id: string;
  generated_at: string;
}

interface CandidateRowWithThemes extends CandidateRow {
  theme_a: { id: string; name: string; description: string | null } | null;
  theme_b: { id: string; name: string; description: string | null } | null;
}

function statsFromRow(
  count: number,
  sessions: number,
  clients: number,
  lastAt: string | null
): ThemeSideStats {
  return {
    assignmentCount: count,
    distinctSessions: sessions,
    distinctClients: clients,
    lastAssignedAt: lastAt,
  };
}

/**
 * Defensive invariant — the DB CHECK constraint enforces `theme_a_id <
 * theme_b_id`, but if the constraint were ever dropped or a row pre-dated
 * it, surfacing the violation here is better than silently feeding an
 * inverted pair into the service's keying logic.
 */
function assertOrdering(row: CandidateRow): void {
  if (row.theme_a_id >= row.theme_b_id) {
    throw new Error(
      `${LOG} pair-ordering invariant violated for candidate ${row.id}: theme_a_id="${row.theme_a_id}" theme_b_id="${row.theme_b_id}"`
    );
  }
}

function mapRow(row: CandidateRow): ThemeCandidate {
  assertOrdering(row);
  return {
    id: row.id,
    teamId: row.team_id,
    initiatedBy: row.initiated_by,
    themeAId: row.theme_a_id,
    themeBId: row.theme_b_id,
    similarityScore: row.similarity_score,
    volumeScore: row.volume_score,
    recencyScore: row.recency_score,
    combinedScore: row.combined_score,
    themeAStats: statsFromRow(
      row.theme_a_assignment_count,
      row.theme_a_distinct_sessions,
      row.theme_a_distinct_clients,
      row.theme_a_last_assigned_at
    ),
    themeBStats: statsFromRow(
      row.theme_b_assignment_count,
      row.theme_b_distinct_sessions,
      row.theme_b_distinct_clients,
      row.theme_b_last_assigned_at
    ),
    sharedKeywords: row.shared_keywords ?? [],
    refreshBatchId: row.refresh_batch_id,
    generatedAt: row.generated_at,
  };
}

function mapRowWithThemes(row: CandidateRowWithThemes): ThemeCandidateWithThemes {
  const base = mapRow(row);

  if (!row.theme_a || !row.theme_b) {
    // Foreign-key cascade should have removed the candidate when either side
    // was deleted — surfacing this loudly catches an inconsistent state.
    throw new Error(
      `${LOG} candidate ${row.id} references missing theme(s): theme_a=${row.theme_a_id} theme_b=${row.theme_b_id}`
    );
  }

  return {
    ...base,
    themeA: {
      id: row.theme_a.id,
      name: row.theme_a.name,
      description: row.theme_a.description,
    },
    themeB: {
      id: row.theme_b.id,
      name: row.theme_b.name,
      description: row.theme_b.description,
    },
  };
}

// ---------------------------------------------------------------------------
// Factory — ThemeCandidateRepository
// ---------------------------------------------------------------------------

export function createThemeCandidateRepository(
  serviceClient: SupabaseClient
): ThemeCandidateRepository {
  return {
    async bulkCreate(rows: ThemeCandidateInsert[]): Promise<void> {
      if (rows.length === 0) {
        console.log(`${LOG} bulkCreate — empty input, skipping`);
        return;
      }

      console.log(`${LOG} bulkCreate — inserting ${rows.length} candidate row(s)`);

      const { error } = await serviceClient
        .from("theme_merge_candidates")
        .insert(rows);

      if (error) {
        console.error(`${LOG} bulkCreate — error:`, error.message);
        throw new Error(`Failed to bulk-create theme candidates: ${error.message}`);
      }

      console.log(`${LOG} bulkCreate — success (${rows.length} rows)`);
    },

    async deleteByWorkspace(
      teamId: string | null,
      userId: string
    ): Promise<void> {
      console.log(
        `${LOG} deleteByWorkspace — teamId: ${teamId}, userId: ${userId}`
      );

      let query = serviceClient.from("theme_merge_candidates").delete();
      query = scopeByTeam(query, teamId);
      if (!teamId) {
        query = query.eq("initiated_by", userId);
      }

      const { error } = await query;

      if (error) {
        console.error(`${LOG} deleteByWorkspace — error:`, error.message);
        throw new Error(
          `Failed to delete candidates for workspace: ${error.message}`
        );
      }

      console.log(`${LOG} deleteByWorkspace — success`);
    },

    async listByWorkspace(
      teamId: string | null,
      userId: string,
      options: ListCandidatesOptions
    ): Promise<ThemeCandidateWithThemes[]> {
      const { limit, offset } = options;
      console.log(
        `${LOG} listByWorkspace — teamId: ${teamId}, userId: ${userId}, limit: ${limit}, offset: ${offset}`
      );

      // PostgREST resolves `theme_a:themes!theme_merge_candidates_theme_a_id_fkey(...)`
      // through the named FK. We use the FK name explicitly so a future second
      // FK to `themes` (e.g., from a different table joined via this view) can't
      // ambiguate the resolution.
      const selectClause = `
        ${COLUMNS},
        theme_a:themes!theme_merge_candidates_theme_a_id_fkey(id, name, description),
        theme_b:themes!theme_merge_candidates_theme_b_id_fkey(id, name, description)
      `;

      let query = serviceClient
        .from("theme_merge_candidates")
        .select(selectClause)
        .order("combined_score", { ascending: false })
        .range(offset, offset + limit - 1);

      query = scopeByTeam(query, teamId);
      if (!teamId) {
        query = query.eq("initiated_by", userId);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`${LOG} listByWorkspace — error:`, error.message);
        throw new Error(`Failed to list theme candidates: ${error.message}`);
      }

      const rows = (data ?? []) as unknown as CandidateRowWithThemes[];
      console.log(`${LOG} listByWorkspace — returning ${rows.length} candidate(s)`);

      return rows.map(mapRowWithThemes);
    },

    async getById(id: string): Promise<ThemeCandidate | null> {
      console.log(`${LOG} getById — id: ${id}`);

      const { data, error } = await serviceClient
        .from("theme_merge_candidates")
        .select(COLUMNS)
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error(`${LOG} getById — error for id ${id}:`, error.message);
        throw new Error(`Failed to fetch theme candidate: ${error.message}`);
      }

      return data ? mapRow(data as unknown as CandidateRow) : null;
    },

    async deleteById(id: string): Promise<void> {
      console.log(`${LOG} deleteById — id: ${id}`);

      const { error } = await serviceClient
        .from("theme_merge_candidates")
        .delete()
        .eq("id", id);

      if (error) {
        console.error(`${LOG} deleteById — error for id ${id}:`, error.message);
        throw new Error(`Failed to delete theme candidate: ${error.message}`);
      }

      console.log(`${LOG} deleteById — success for id: ${id}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Factory — ThemeCandidatePairsRepository (RPC wrapper)
// ---------------------------------------------------------------------------

export function createThemeCandidatePairsRepository(
  serviceClient: SupabaseClient
): ThemeCandidatePairsRepository {
  return {
    async findPairs(
      teamId: string | null,
      userId: string,
      threshold: number
    ): Promise<CandidatePair[]> {
      console.log(
        `${LOG} findPairs — teamId: ${teamId}, userId: ${userId}, threshold: ${threshold}`
      );

      const { data, error } = await serviceClient.rpc(
        "find_theme_candidate_pairs",
        {
          filter_team_id: teamId,
          filter_user_id: !teamId ? userId : null,
          similarity_threshold: threshold,
        }
      );

      if (error) {
        console.error(`${LOG} findPairs — error:`, error.message);
        throw new Error(`find_theme_candidate_pairs failed: ${error.message}`);
      }

      const rows = (data ?? []) as Array<{
        theme_a_id: string;
        theme_b_id: string;
        similarity: number;
      }>;

      console.log(`${LOG} findPairs — returning ${rows.length} pair(s)`);

      return rows.map((row) => ({
        themeAId: row.theme_a_id,
        themeBId: row.theme_b_id,
        similarity: row.similarity,
      }));
    },
  };
}
