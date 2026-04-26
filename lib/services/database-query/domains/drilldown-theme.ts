// ---------------------------------------------------------------------------
// Database Query — Theme Drill-down Strategy
// ---------------------------------------------------------------------------
// Theme drill-downs (theme / theme_bucket / theme_client) operate on a
// signal_themes ⨝ session_embeddings ⨝ sessions ⨝ clients join with theme_id
// fixed up-front — fundamentally different from the sessions-first path of
// direct/competitor. Lives in its own module per P5.R4 (the dedupe target
// is direct ↔ competitor only).
//
// Team / date / clientIds filtering is applied via applyThemeJoinFilters
// (shared with fetchSignalThemeRows) — confidence threshold and the
// drill-down-specific opts (clientId, bucket) stay inline because they're
// scoped to this strategy.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { LOG_PREFIX } from "../action-metadata";
import { dateTrunc } from "../shared/row-helpers";
import {
  applyThemeJoinFilters,
  fetchActiveThemeMap,
} from "../shared/theme-helpers";
import type { DrillDownRow, QueryFilters } from "../types";

/**
 * Fetches signals assigned to a theme via signal_themes → session_embeddings →
 * sessions → clients. Optionally narrows by date bucket or client.
 */
export async function fetchThemeDrillDownRows(
  supabase: SupabaseClient,
  filters: QueryFilters,
  themeId: string,
  opts?: { bucket?: string; clientId?: string }
): Promise<DrillDownRow[]> {
  // Resolve theme name
  const themeMap = await fetchActiveThemeMap(supabase, filters.teamId);
  const themeName = themeMap.get(themeId) ?? null;

  // Query signal_themes with nested joins
  let query = supabase
    .from("signal_themes")
    .select(
      `
      embedding_id,
      confidence,
      session_embeddings!inner(
        id,
        chunk_text,
        chunk_type,
        metadata,
        session_id,
        team_id,
        sessions!inner(
          session_date,
          client_id,
          deleted_at,
          clients(name)
        )
      )
    `
    )
    .eq("theme_id", themeId)
    .is("session_embeddings.sessions.deleted_at", null);

  // Standard team / date-range / clientIds filter chain
  query = applyThemeJoinFilters(query, filters);

  // Confidence threshold (signal_themes-level, not part of the join filter)
  if (filters.confidenceMin !== undefined) {
    query = query.gte("confidence", filters.confidenceMin);
  }

  // Theme-client drill-down: narrow to specific client
  if (opts?.clientId) {
    query = query.eq("session_embeddings.sessions.client_id", opts.clientId);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${LOG_PREFIX} drill_down theme fetch error:`, error);
    throw new Error("Failed to fetch drill-down data for theme");
  }

  // Parse nested join results
  type ThemeDrillRow = {
    embedding_id: string;
    confidence: number | null;
    session_embeddings: {
      id: string;
      chunk_text: string;
      chunk_type: string;
      metadata: Record<string, unknown> | null;
      session_id: string;
      sessions: {
        session_date: string;
        client_id: string;
        deleted_at: string | null;
        clients: { name: string } | null;
      };
    };
  };

  const typedRows = (data ?? []) as unknown as ThemeDrillRow[];
  const granularity = filters.granularity ?? "week";

  const rows: DrillDownRow[] = [];

  for (const row of typedRows) {
    const emb = row.session_embeddings;
    const session = emb.sessions;

    // Theme-bucket drill-down: narrow to the clicked time bucket
    if (opts?.bucket) {
      const rowBucket = dateTrunc(
        granularity,
        new Date(session.session_date)
      );
      if (rowBucket !== opts.bucket) continue;
    }

    rows.push({
      embeddingId: emb.id,
      sessionId: emb.session_id,
      sessionDate: session.session_date,
      chunkText: emb.chunk_text,
      chunkType: emb.chunk_type,
      themeName,
      metadata: emb.metadata ?? {},
      clientId: session.client_id,
      clientName: session.clients?.name ?? "Unknown",
    });
  }

  // Sort by session_date descending
  rows.sort(
    (a, b) =>
      new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime()
  );

  return rows;
}
