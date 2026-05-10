import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  EmbeddingRepository,
  EmbeddingRow,
  FtsResult,
  FtsSearchOptions,
  SearchOptions,
  SessionChunkRow,
  SignalFilters,
  SimilarityResult,
} from "../embedding-repository";

const LOG_PREFIX = "[supabase-embedding-repo]";

/**
 * Factory for creating a Supabase-backed EmbeddingRepository.
 *
 * Uses the service-role client for all operations — embedding writes are
 * trusted server-side operations that have already passed auth checks
 * in the parent API route. Reads (similarity search) use the RPC function
 * which applies team scoping via parameters.
 *
 * @param serviceClient - Service-role client (bypasses RLS)
 * @param teamId        - Active workspace scope (null = personal)
 * @param userId        - Authenticated user ID — used to enforce personal workspace
 *                        isolation in the similarity search RPC (prevents cross-user
 *                        data leakage when teamId is null).
 */
export function createEmbeddingRepository(
  serviceClient: SupabaseClient,
  teamId: string | null,
  userId?: string
): EmbeddingRepository {
  return {
    async upsertChunks(chunks: EmbeddingRow[]): Promise<string[]> {
      if (chunks.length === 0) {
        return [];
      }

      const sessionId = chunks[0].session_id;
      console.log(
        `${LOG_PREFIX} upsertChunks — ${chunks.length} chunks for session: ${sessionId}`
      );

      const rows = chunks.map((chunk) => ({
        ...chunk,
        embedding: `[${chunk.embedding.join(",")}]`,
      }));

      const { data, error } = await serviceClient
        .from("session_embeddings")
        .insert(rows)
        .select("id");

      if (error) {
        console.error(
          `${LOG_PREFIX} upsertChunks — error for session ${sessionId}:`,
          error.message
        );
        throw new Error(`Failed to insert embeddings: ${error.message}`);
      }

      const ids = (data ?? []).map((row: { id: string }) => row.id);

      console.log(
        `${LOG_PREFIX} upsertChunks — success, ${ids.length} chunks inserted for session: ${sessionId}`
      );

      return ids;
    },

    async deleteBySessionId(sessionId: string): Promise<void> {
      console.log(`${LOG_PREFIX} deleteBySessionId — session: ${sessionId}`);

      const { error } = await serviceClient
        .from("session_embeddings")
        .delete()
        .eq("session_id", sessionId);

      if (error) {
        console.error(
          `${LOG_PREFIX} deleteBySessionId — error for session ${sessionId}:`,
          error.message
        );
        throw new Error(
          `Failed to delete embeddings for session ${sessionId}: ${error.message}`
        );
      }

      console.log(
        `${LOG_PREFIX} deleteBySessionId — success for session: ${sessionId}`
      );
    },

    async similaritySearch(
      queryEmbedding: number[],
      options: SearchOptions
    ): Promise<SimilarityResult[]> {
      const {
        maxResults,
        chunkTypes,
        clientName,
        dateFrom,
        dateTo,
        similarityThreshold = 0.3,
      } = options;

      console.log(
        `${LOG_PREFIX} similaritySearch — teamId: ${teamId}, maxResults: ${maxResults}, chunkTypes: ${chunkTypes?.join(",") ?? "all"}, threshold: ${similarityThreshold}`
      );

      const { data, error } = await serviceClient.rpc(
        "match_session_embeddings",
        {
          query_embedding: `[${queryEmbedding.join(",")}]`,
          match_count: maxResults,
          similarity_threshold: similarityThreshold,
          filter_team_id: teamId,
          filter_user_id: !teamId && userId ? userId : null,
          filter_chunk_types: chunkTypes ?? null,
          filter_client_name: clientName ?? null,
          filter_date_from: dateFrom ?? null,
          filter_date_to: dateTo ?? null,
        }
      );

      if (error) {
        console.error(
          `${LOG_PREFIX} similaritySearch — error:`,
          error.message
        );
        throw new Error(`Similarity search failed: ${error.message}`);
      }

      const results: SimilarityResult[] = (data ?? []).map(
        (row: {
          id: string;
          session_id: string;
          chunk_text: string;
          chunk_type: string;
          metadata: Record<string, unknown>;
          similarity: number;
        }) => ({
          id: row.id,
          sessionId: row.session_id,
          chunkText: row.chunk_text,
          chunkType: row.chunk_type,
          metadata: row.metadata,
          similarityScore: row.similarity,
        })
      );

      console.log(
        `${LOG_PREFIX} similaritySearch — returning ${results.length} results`
      );

      return results;
    },

    async fullTextSearch(
      queryText: string,
      options: FtsSearchOptions
    ): Promise<FtsResult[]> {
      const { maxResults, chunkTypes, clientName, dateFrom, dateTo } = options;

      console.log(
        `${LOG_PREFIX} fullTextSearch — teamId: ${teamId}, maxResults: ${maxResults}, query: "${queryText.slice(0, 80)}"`
      );

      const { data, error } = await serviceClient.rpc(
        "match_session_embeddings_fts",
        {
          query_text: queryText,
          match_count: maxResults,
          filter_team_id: teamId,
          filter_user_id: !teamId && userId ? userId : null,
          filter_chunk_types: chunkTypes ?? null,
          filter_client_name: clientName ?? null,
          filter_date_from: dateFrom ?? null,
          filter_date_to: dateTo ?? null,
        }
      );

      if (error) {
        console.error(
          `${LOG_PREFIX} fullTextSearch — error:`,
          error.message
        );
        throw new Error(`Full-text search failed: ${error.message}`);
      }

      const results: FtsResult[] = (data ?? []).map(
        (row: {
          id: string;
          session_id: string;
          chunk_text: string;
          chunk_type: string;
          metadata: Record<string, unknown>;
          fts_rank: number;
        }) => ({
          id: row.id,
          sessionId: row.session_id,
          chunkText: row.chunk_text,
          chunkType: row.chunk_type,
          metadata: row.metadata,
          ftsRank: row.fts_rank,
        })
      );

      console.log(
        `${LOG_PREFIX} fullTextSearch — returning ${results.length} results`
      );

      return results;
    },

    async fetchBySessionIds(
      sessionIds: string[],
      options: { teamId: string | null; userId?: string }
    ): Promise<SessionChunkRow[]> {
      if (sessionIds.length === 0) return [];

      console.log(
        `${LOG_PREFIX} fetchBySessionIds — ${sessionIds.length} sessions, teamId: ${options.teamId}`
      );

      let query = serviceClient
        .from("session_embeddings")
        .select("id, session_id, chunk_text, chunk_type, metadata")
        .in("session_id", sessionIds);

      if (options.teamId) {
        query = query.eq("team_id", options.teamId);
      } else {
        query = query.is("team_id", null);
        // Personal workspace — extra session-level guard via the join is
        // unnecessary here because the session ids were resolved through
        // the session repo which already applies the personal scope.
      }

      const { data, error } = await query;

      if (error) {
        console.error(
          `${LOG_PREFIX} fetchBySessionIds — error:`,
          error.message
        );
        throw new Error(`Fetch chunks by session ids failed: ${error.message}`);
      }

      const rows: SessionChunkRow[] = (data ?? []).map((row) => ({
        id: row.id as string,
        sessionId: row.session_id as string,
        chunkText: row.chunk_text as string,
        chunkType: row.chunk_type as string,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      }));

      console.log(
        `${LOG_PREFIX} fetchBySessionIds — returning ${rows.length} chunks across ${sessionIds.length} sessions`
      );

      return rows;
    },

    async listSignals(filters: SignalFilters): Promise<SessionChunkRow[]> {
      const limit = filters.limit ?? 200;

      console.log(
        `${LOG_PREFIX} listSignals — teamId: ${filters.teamId}, theme: ${filters.themeName ?? "any"}, chunkTypes: ${filters.chunkTypes?.join(",") ?? "all"}, severity: ${filters.severity ?? "any"}, urgency: ${filters.urgency ?? "any"}, limit: ${limit}`
      );

      // If themeName is set we go through the signal_themes join; otherwise
      // we query session_embeddings directly with date / client filters
      // applied via a sessions-table EXISTS (or join) check.
      if (filters.themeName) {
        // signal_themes join path — fetch theme id first, then join.
        const { data: themes, error: themeErr } = await serviceClient
          .from("themes")
          .select("id")
          .ilike("name", filters.themeName)
          .eq("is_archived", false);

        if (themeErr) {
          console.error(`${LOG_PREFIX} listSignals theme lookup — error:`, themeErr.message);
          throw new Error(`Theme lookup failed: ${themeErr.message}`);
        }

        const themeIds = (themes ?? []).map((t: { id: string }) => t.id);
        if (themeIds.length === 0) {
          return [];
        }

        const { data: junctionRows, error: jErr } = await serviceClient
          .from("signal_themes")
          .select("embedding_id")
          .in("theme_id", themeIds);

        if (jErr) {
          console.error(`${LOG_PREFIX} listSignals junction — error:`, jErr.message);
          throw new Error(`Signal-theme junction lookup failed: ${jErr.message}`);
        }

        const embeddingIds = (junctionRows ?? []).map(
          (r: { embedding_id: string }) => r.embedding_id
        );
        if (embeddingIds.length === 0) return [];

        let q = serviceClient
          .from("session_embeddings")
          .select("id, session_id, chunk_text, chunk_type, metadata")
          .in("id", embeddingIds)
          .limit(limit);

        if (filters.teamId) {
          q = q.eq("team_id", filters.teamId);
        } else {
          q = q.is("team_id", null);
        }

        if (filters.chunkTypes && filters.chunkTypes.length > 0) {
          q = q.in("chunk_type", filters.chunkTypes);
        }

        const { data, error } = await q;
        if (error) {
          console.error(`${LOG_PREFIX} listSignals join — error:`, error.message);
          throw new Error(`Signals listing failed: ${error.message}`);
        }

        return applyMetadataFilters(
          (data ?? []).map((row) => ({
            id: row.id as string,
            sessionId: row.session_id as string,
            chunkText: row.chunk_text as string,
            chunkType: row.chunk_type as string,
            metadata: (row.metadata ?? {}) as Record<string, unknown>,
          })),
          { severity: filters.severity, urgency: filters.urgency }
        );
      }

      // No theme filter — direct query.
      let q = serviceClient
        .from("session_embeddings")
        .select("id, session_id, chunk_text, chunk_type, metadata")
        .limit(limit);

      if (filters.teamId) {
        q = q.eq("team_id", filters.teamId);
      } else {
        q = q.is("team_id", null);
      }

      if (filters.chunkTypes && filters.chunkTypes.length > 0) {
        q = q.in("chunk_type", filters.chunkTypes);
      }

      const { data, error } = await q;
      if (error) {
        console.error(`${LOG_PREFIX} listSignals direct — error:`, error.message);
        throw new Error(`Signals listing failed: ${error.message}`);
      }

      return applyMetadataFilters(
        (data ?? []).map((row) => ({
          id: row.id as string,
          sessionId: row.session_id as string,
          chunkText: row.chunk_text as string,
          chunkType: row.chunk_type as string,
          metadata: (row.metadata ?? {}) as Record<string, unknown>,
        })),
        { severity: filters.severity, urgency: filters.urgency }
      );
    },
  };
}

/**
 * In-memory severity / urgency filtering applied after the SQL pull. We do
 * this in TS because severity and urgency live inside the metadata JSONB and
 * the existing severity-filter helper (database-query/shared) operates at
 * the session level, not the chunk level.
 */
function applyMetadataFilters(
  rows: SessionChunkRow[],
  metaFilters: { severity?: string; urgency?: string }
): SessionChunkRow[] {
  if (!metaFilters.severity && !metaFilters.urgency) {
    return rows;
  }
  return rows.filter((row) => {
    if (
      metaFilters.severity &&
      String(row.metadata?.severity ?? "").toLowerCase() !==
        metaFilters.severity
    ) {
      return false;
    }
    if (
      metaFilters.urgency &&
      String(row.metadata?.urgency ?? "").toLowerCase() !==
        metaFilters.urgency
    ) {
      return false;
    }
    return true;
  });
}
