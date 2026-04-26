// ---------------------------------------------------------------------------
// Database Query — Direct Drill-down Strategies
// ---------------------------------------------------------------------------
// Direct drill-downs (sentiment / urgency / client) and the competitor
// variant share the same row-fetch + filter + merge skeleton:
//   1. Fetch sessions (team/date/clientIds via baseSessionQuery, optional
//      clientId filter, optional in-memory session predicate)
//   2. Fetch embeddings for matching session IDs (optional chunk_type
//      filter, team scoping, optional in-memory embedding predicate)
//   3. Merge into flat DrillDownRow[]
//
// The four asymmetries between the two call sites (case-sensitivity of the
// session predicate, optional clientId, embedding chunk_type filter, and
// per-embedding metadata predicate) are encoded as parameters of
// `fetchDrillDownRows`. The helper does not impose a uniform comparison —
// each call site supplies its own equality semantics. (PRD-023 P5.R4)
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { LOG_PREFIX } from "../action-metadata";
import { baseSessionQuery } from "../shared/base-query-builder";
import type { DrillDownRow, QueryFilters } from "../types";

interface SessionRow {
  id: string;
  session_date: string;
  client_id: string;
  structured_json: Record<string, unknown> | null;
  clients: { name: string } | null;
}

interface EmbeddingRow {
  id: string;
  session_id: string;
  chunk_text: string;
  chunk_type: string;
  metadata: Record<string, unknown> | null;
}

interface DrillDownFetchOptions {
  /** Optional client_id filter applied at the SQL level on sessions. */
  clientId?: string;
  /** Optional in-memory predicate to filter sessions before the embedding fetch. */
  sessionPredicate?: (session: SessionRow) => boolean;
  /** Optional chunk_type filter applied at the SQL level on session_embeddings. */
  embeddingChunkType?: string;
  /** Optional in-memory predicate to filter embeddings post-fetch. */
  embeddingPredicate?: (embedding: EmbeddingRow) => boolean;
  /**
   * Log label inserted into error logs and exception messages so the direct
   * and competitor call sites preserve their pre-cleanup wording verbatim.
   * Empty/undefined for direct drill-downs; "competitor" for the competitor
   * variant. Production grep / alerting patterns key on the resulting strings.
   */
  logLabel?: string;
}

/**
 * Shared row-fetch + filter + merge skeleton used by direct and competitor
 * drill-downs. Returns flat DrillDownRow[] in the order the embedding query
 * returned them (sessions are sorted by session_date desc; embeddings by
 * created_at desc — the merge preserves the embedding-fetch order).
 *
 * Behavior preservation contract (P5.R4):
 *   - Session SQL: same select shape, same `.not("structured_json", "is", null)`,
 *     same baseSessionQuery filter chain, same `order("session_date", desc)`.
 *     Optional clientId filter applied only when options.clientId is set.
 *   - Session in-memory filter: only runs when options.sessionPredicate is
 *     set. Direct paths use `===` (case-sensitive scalar JSON match);
 *     competitor uses case-insensitive array search. The predicate encodes
 *     each call site's exact equality semantics.
 *   - Embedding SQL: same select, same in-clause on session_id, same team
 *     scoping (eq team_id when set, is null otherwise), same created_at desc
 *     order. chunk_type eq filter applied only when options.embeddingChunkType
 *     is set.
 *   - Embedding in-memory filter: only runs when options.embeddingPredicate
 *     is set. Used by competitor to match metadata.competitor case-insensitively.
 *   - themeName is null on every returned row.
 */
async function fetchDrillDownRows(
  supabase: SupabaseClient,
  filters: QueryFilters,
  options: DrillDownFetchOptions
): Promise<DrillDownRow[]> {
  const labelSpace = options.logLabel ? ` ${options.logLabel}` : "";
  const labelFor = options.logLabel ? ` for ${options.logLabel}` : "";

  // Step 1: Get matching sessions
  let sessionQuery = baseSessionQuery(
    supabase
      .from("sessions")
      .select("id, session_date, client_id, structured_json, clients(name)")
      .not("structured_json", "is", null)
      .order("session_date", { ascending: false }),
    filters
  );

  if (options.clientId) {
    sessionQuery = sessionQuery.eq("client_id", options.clientId);
  }

  const { data: sessions, error: sessError } = await sessionQuery;
  if (sessError) {
    console.error(
      `${LOG_PREFIX} drill_down${labelSpace} session fetch error:`,
      sessError
    );
    throw new Error(`Failed to fetch drill-down sessions${labelFor}`);
  }

  if (!sessions || sessions.length === 0) return [];

  // Step 2: Optional session-level predicate
  let filtered = sessions as SessionRow[];
  if (options.sessionPredicate) {
    filtered = filtered.filter(options.sessionPredicate);
  }

  if (filtered.length === 0) return [];

  const sessionIds = filtered.map((s) => s.id);
  const sessionLookup = new Map<string, SessionRow>();
  for (const s of filtered) {
    sessionLookup.set(s.id, s);
  }

  // Step 3: Fetch embeddings for matching sessions
  let embeddingQuery = supabase
    .from("session_embeddings")
    .select("id, session_id, chunk_text, chunk_type, metadata")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });

  if (options.embeddingChunkType) {
    embeddingQuery = embeddingQuery.eq("chunk_type", options.embeddingChunkType);
  }

  // Team scoping on embeddings
  if (filters.teamId) {
    embeddingQuery = embeddingQuery.eq("team_id", filters.teamId);
  } else {
    embeddingQuery = embeddingQuery.is("team_id", null);
  }

  const { data: embeddings, error: embError } = await embeddingQuery;
  if (embError) {
    console.error(
      `${LOG_PREFIX} drill_down${labelSpace} embedding fetch error:`,
      embError
    );
    throw new Error(`Failed to fetch drill-down embeddings${labelFor}`);
  }

  // Step 4: Merge with optional embedding-level predicate
  const rows: DrillDownRow[] = [];

  for (const emb of (embeddings ?? []) as EmbeddingRow[]) {
    if (options.embeddingPredicate && !options.embeddingPredicate(emb)) {
      continue;
    }
    const session = sessionLookup.get(emb.session_id);
    if (!session) continue;

    rows.push({
      embeddingId: emb.id,
      sessionId: emb.session_id,
      sessionDate: session.session_date,
      chunkText: emb.chunk_text,
      chunkType: emb.chunk_type,
      themeName: null, // direct drill-downs don't carry theme info
      metadata: emb.metadata ?? {},
      clientId: session.client_id,
      clientName: session.clients?.name ?? "Unknown",
    });
  }

  return rows;
}

/**
 * Fetches signal rows for direct widget drill-downs (sentiment, urgency,
 * client). Translates the legacy { jsonField, jsonValue, clientId } shape
 * into the shared helper's predicate-driven options. Direct paths use strict
 * (`===`) case-sensitive comparison on the scalar `structured_json` field —
 * preserved verbatim from the pre-cleanup behavior.
 */
export async function fetchDirectDrillDownRows(
  supabase: SupabaseClient,
  filters: QueryFilters,
  sessionFilter: {
    jsonField?: string;
    jsonValue?: string;
    clientId?: string;
  }
): Promise<DrillDownRow[]> {
  const sessionPredicate =
    sessionFilter.jsonField && sessionFilter.jsonValue
      ? (s: SessionRow) => {
          const val = s.structured_json?.[sessionFilter.jsonField!] as
            | string
            | undefined;
          return val === sessionFilter.jsonValue;
        }
      : undefined;

  return fetchDrillDownRows(supabase, filters, {
    clientId: sessionFilter.clientId,
    sessionPredicate,
  });
}

/**
 * Handles the competitor drill-down variant. Filters sessions whose
 * `structured_json.competitiveMentions` contains a case-insensitive match,
 * then fetches `competitive_mention` embeddings whose metadata.competitor
 * matches case-insensitively. Both comparisons preserved verbatim from the
 * pre-cleanup behavior.
 */
export async function handleCompetitorDrillDown(
  supabase: SupabaseClient,
  filters: QueryFilters,
  competitor: string
): Promise<DrillDownRow[]> {
  const lower = competitor.toLowerCase();

  return fetchDrillDownRows(supabase, filters, {
    sessionPredicate: (s) => {
      const mentions = s.structured_json?.competitiveMentions as
        | Array<{ competitor?: string }>
        | undefined;
      if (!mentions) return false;
      return mentions.some((m) => m.competitor?.toLowerCase() === lower);
    },
    embeddingChunkType: "competitive_mention",
    embeddingPredicate: (emb) => {
      const meta = emb.metadata ?? {};
      const embCompetitor = (meta.competitor as string) ?? "";
      return embCompetitor.toLowerCase() === lower;
    },
    logLabel: "competitor",
  });
}
