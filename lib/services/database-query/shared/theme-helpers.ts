// ---------------------------------------------------------------------------
// Database Query — Theme Helpers
// ---------------------------------------------------------------------------
// Theme-related query primitives shared by the theme widget handlers
// (top_themes / theme_trends / theme_client_matrix) and the theme drill-down
// strategies (theme / theme_bucket / theme_client).
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { scopeByTeam } from "@/lib/repositories/supabase/scope-by-team";

import { LOG_PREFIX } from "../action-metadata";
import type { QueryFilters } from "../types";
import { resolveSessionIdsBySeverity } from "./severity-filter";

/**
 * Row shape returned by the signal_themes → session_embeddings → sessions
 * nested join query. Supabase returns nested objects for joins.
 */
export interface SignalThemeJoinRow {
  theme_id: string;
  confidence: number | null;
  session_embeddings: {
    chunk_type: string;
    session_id: string;
    sessions: {
      session_date: string;
      client_id: string;
      deleted_at: string | null;
    };
  };
}

/**
 * Applies the standard team / date-range / clientIds filter set to a
 * signal_themes ⨝ session_embeddings ⨝ sessions query. The same chain is
 * used by fetchSignalThemeRows (theme widgets) and the theme drill-down
 * fetcher; extracting it keeps the join filter shape in one place (P5.R3).
 *
 * Severity and confidence threshold are call-site specific and stay inline
 * at each caller (severity uses a pre-resolved session-ID set, confidence
 * targets the signal_themes table directly).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are loosely typed
export function applyThemeJoinFilters(query: any, filters: QueryFilters): any {
  let q = query;

  // Team scoping on session_embeddings (which carries team_id)
  if (filters.teamId) {
    q = q.eq("session_embeddings.team_id", filters.teamId);
  } else {
    q = q.is("session_embeddings.team_id", null);
  }

  // Date range filters on sessions
  if (filters.dateFrom) {
    q = q.gte("session_embeddings.sessions.session_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    q = q.lte("session_embeddings.sessions.session_date", filters.dateTo);
  }

  // Client ID filter on sessions
  if (filters.clientIds && filters.clientIds.length > 0) {
    q = q.in("session_embeddings.sessions.client_id", filters.clientIds);
  }

  return q;
}

/**
 * Fetches all active (non-archived) themes for a workspace and returns a
 * Map of id → name. Used by all 3 theme widget handlers.
 */
export async function fetchActiveThemeMap(
  supabase: SupabaseClient,
  teamId: string | null
): Promise<Map<string, string>> {
  let query = supabase
    .from("themes")
    .select("id, name")
    .eq("is_archived", false);

  query = scopeByTeam(query, teamId);

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} fetchActiveThemeMap error:`, error);
    throw new Error("Failed to fetch active themes");
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
    map.set(row.id, row.name);
  }

  return map;
}

/**
 * Fetches signal_themes joined through session_embeddings → sessions,
 * applying team scoping, date range, client IDs, and confidence threshold.
 * Shared by all 3 theme widget handlers.
 */
export async function fetchSignalThemeRows(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<SignalThemeJoinRow[]> {
  // Severity is per-chunk in `structured_json` and not joinable via SQL.
  // Pre-resolve the matching session IDs and constrain the join to them.
  // When severity is set but no sessions match, short-circuit with an empty
  // result so the join doesn't broaden into "no filter at all".
  const severitySessionIds = await resolveSessionIdsBySeverity(
    supabase,
    filters
  );
  if (severitySessionIds && severitySessionIds.size === 0) {
    return [];
  }

  let query = supabase
    .from("signal_themes")
    .select(
      `
      theme_id,
      confidence,
      session_embeddings!inner(
        chunk_type,
        session_id,
        team_id,
        sessions!inner(
          session_date,
          client_id,
          deleted_at
        )
      )
    `
    )
    .is("session_embeddings.sessions.deleted_at", null);

  query = applyThemeJoinFilters(query, filters);

  // Severity filter — restrict to pre-resolved session IDs that have at
  // least one signal chunk with the requested severity.
  if (severitySessionIds) {
    query = query.in(
      "session_embeddings.session_id",
      Array.from(severitySessionIds)
    );
  }

  // Confidence threshold on signal_themes
  if (filters.confidenceMin !== undefined) {
    query = query.gte("confidence", filters.confidenceMin);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} fetchSignalThemeRows error:`, error);
    throw new Error("Failed to fetch signal theme data");
  }

  return (data ?? []) as unknown as SignalThemeJoinRow[];
}
