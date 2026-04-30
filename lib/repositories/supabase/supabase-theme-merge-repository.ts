import { type SupabaseClient } from "@supabase/supabase-js";

import type { MergeResult, ThemeMerge } from "@/lib/types/theme-merge";

import {
  MergeNotFoundError,
  MergeRepoError,
  MergeValidationError,
  type ListMergesOptions,
  type ThemeMergeRepository,
} from "../theme-merge-repository";
import { scopeByTeam } from "./scope-by-team";

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const LOG = "[supabase-theme-merge-repo]";

const COLUMNS = `
  id, team_id, initiated_by,
  archived_theme_id, canonical_theme_id,
  archived_theme_name, canonical_theme_name,
  actor_id, reassigned_count, distinct_sessions, distinct_clients,
  merged_at
`;

interface MergeRow {
  id: string;
  team_id: string | null;
  initiated_by: string;
  archived_theme_id: string;
  canonical_theme_id: string;
  archived_theme_name: string;
  canonical_theme_name: string;
  actor_id: string;
  reassigned_count: number;
  distinct_sessions: number;
  distinct_clients: number;
  merged_at: string;
}

/** Shape returned by the `merge_themes` RPC (positional TABLE columns). */
interface MergeRpcRow {
  audit_id: string;
  reassigned_count: number;
  distinct_sessions: number;
  distinct_clients: number;
  archived_theme_name: string;
  canonical_theme_name: string;
  team_id: string | null;
}

function mapRow(row: MergeRow): ThemeMerge {
  return {
    id: row.id,
    teamId: row.team_id,
    initiatedBy: row.initiated_by,
    archivedThemeId: row.archived_theme_id,
    canonicalThemeId: row.canonical_theme_id,
    archivedThemeName: row.archived_theme_name,
    canonicalThemeName: row.canonical_theme_name,
    actorId: row.actor_id,
    reassignedCount: row.reassigned_count,
    distinctSessions: row.distinct_sessions,
    distinctClients: row.distinct_clients,
    mergedAt: row.merged_at,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createThemeMergeRepository(
  serviceClient: SupabaseClient
): ThemeMergeRepository {
  return {
    async executeMerge(input): Promise<MergeResult> {
      console.log(
        `${LOG} executeMerge — archived: ${input.archivedThemeId}, canonical: ${input.canonicalThemeId}, actor: ${input.actorId}`
      );

      const { data, error } = await serviceClient.rpc("merge_themes", {
        archived_theme_id: input.archivedThemeId,
        canonical_theme_id: input.canonicalThemeId,
        acting_user_id: input.actorId,
      });

      if (error) {
        // SQLSTATE codes raised inside the merge_themes function map to
        // typed errors so the route layer can translate to HTTP statuses
        // without re-parsing strings.
        if (error.code === "22023") {
          console.warn(
            `${LOG} executeMerge — validation failure: ${error.message}`
          );
          throw new MergeValidationError(error.message);
        }
        if (error.code === "P0002") {
          console.warn(`${LOG} executeMerge — not found: ${error.message}`);
          throw new MergeNotFoundError(error.message);
        }
        console.error(`${LOG} executeMerge — error:`, error.message);
        throw new MergeRepoError(`merge_themes failed: ${error.message}`);
      }

      const rows = (data ?? []) as MergeRpcRow[];
      const row = rows[0];
      if (!row) {
        console.error(`${LOG} executeMerge — RPC returned no row`);
        throw new MergeRepoError("merge_themes returned no row");
      }

      console.log(
        `${LOG} executeMerge — success | audit: ${row.audit_id} | reassigned: ${row.reassigned_count}`
      );

      // archivedThemeId / canonicalThemeId aren't in the RPC's TABLE return
      // (the caller already supplied them); echo the input through so the
      // service consumer gets a complete MergeResult in one shot.
      return {
        auditId: row.audit_id,
        archivedThemeId: input.archivedThemeId,
        archivedThemeName: row.archived_theme_name,
        canonicalThemeId: input.canonicalThemeId,
        canonicalThemeName: row.canonical_theme_name,
        signalAssignmentsRepointed: row.reassigned_count,
        distinctSessions: row.distinct_sessions,
        distinctClients: row.distinct_clients,
        teamId: row.team_id,
      };
    },

    async listByWorkspace(
      teamId: string | null,
      userId: string,
      options: ListMergesOptions
    ): Promise<ThemeMerge[]> {
      const { limit, offset } = options;
      console.log(
        `${LOG} listByWorkspace — teamId: ${teamId}, userId: ${userId}, limit: ${limit}, offset: ${offset}`
      );

      let query = serviceClient
        .from("theme_merges")
        .select(COLUMNS)
        .order("merged_at", { ascending: false })
        .range(offset, offset + limit - 1);

      query = scopeByTeam(query, teamId);
      if (!teamId) {
        query = query.eq("initiated_by", userId);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`${LOG} listByWorkspace — error:`, error.message);
        throw new MergeRepoError(
          `Failed to list theme merges: ${error.message}`
        );
      }

      const rows = (data ?? []) as unknown as MergeRow[];
      console.log(
        `${LOG} listByWorkspace — returning ${rows.length} merge(s)`
      );

      return rows.map(mapRow);
    },
  };
}
