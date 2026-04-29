import { type SupabaseClient } from "@supabase/supabase-js";

import {
  pairKey,
  type ThemeDismissalInsert,
  type ThemeDismissalRepository,
} from "../theme-dismissal-repository";
import { scopeByTeam } from "./scope-by-team";

const LOG = "[supabase-theme-dismissal-repo]";

/**
 * Postgres unique-constraint violation code. Indicates a duplicate-key
 * insert; for the dismissals table that means the pair was already
 * dismissed in this workspace, which is an idempotent no-op.
 */
const PG_UNIQUE_VIOLATION = "23505";

interface DismissalKeyRow {
  theme_a_id: string;
  theme_b_id: string;
}

export function createThemeDismissalRepository(
  serviceClient: SupabaseClient
): ThemeDismissalRepository {
  return {
    async create(input: ThemeDismissalInsert): Promise<void> {
      console.log(
        `${LOG} create — pair: ${input.theme_a_id}/${input.theme_b_id}, teamId: ${input.team_id}, dismissedBy: ${input.dismissed_by}`
      );

      const { error } = await serviceClient
        .from("theme_merge_dismissals")
        .insert(input);

      if (error) {
        // Re-dismissing the same pair is a no-op, not an error.
        if (error.code === PG_UNIQUE_VIOLATION) {
          console.log(
            `${LOG} create — pair already dismissed for this workspace, treating as no-op`
          );
          return;
        }
        console.error(`${LOG} create — error:`, error.message);
        throw new Error(`Failed to record theme dismissal: ${error.message}`);
      }

      console.log(`${LOG} create — success`);
    },

    async listPairKeysByWorkspace(
      teamId: string | null,
      userId: string
    ): Promise<Set<string>> {
      console.log(
        `${LOG} listPairKeysByWorkspace — teamId: ${teamId}, userId: ${userId}`
      );

      let query = serviceClient
        .from("theme_merge_dismissals")
        .select("theme_a_id, theme_b_id");

      query = scopeByTeam(query, teamId);
      if (!teamId) {
        query = query.eq("initiated_by", userId);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`${LOG} listPairKeysByWorkspace — error:`, error.message);
        throw new Error(`Failed to list dismissals: ${error.message}`);
      }

      const rows = (data ?? []) as DismissalKeyRow[];
      const keys = new Set(rows.map((r) => pairKey(r.theme_a_id, r.theme_b_id)));

      console.log(
        `${LOG} listPairKeysByWorkspace — returning ${keys.size} dismissed pair(s)`
      );

      return keys;
    },
  };
}
