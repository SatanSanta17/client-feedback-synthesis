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
        `${LOG_PREFIX} listSignals — teamId: ${filters.teamId}, theme: ${filters.themeName ?? "any"}, chunkTypes: ${filters.chunkTypes?.join(",") ?? "all"}, severity: ${filters.severity ?? "any"}, urgency: ${filters.urgency ?? "any"}, clientName: ${filters.clientName ?? "any"}, dateFrom: ${filters.dateFrom ?? "any"}, dateTo: ${filters.dateTo ?? "any"}, limit: ${limit}`
      );

      // Single RPC hop — every filter is applied at SQL level so `limit`
      // caps the correctly-filtered set, not an arbitrary pre-filter
      // slice. PRD-033 P1.R5 completeness guarantee. See migration 003.
      const { data, error } = await serviceClient.rpc(
        "match_signals_filtered",
        {
          filter_team_id: filters.teamId,
          filter_user_id: !filters.teamId && filters.userId ? filters.userId : null,
          filter_client_name: filters.clientName ?? null,
          filter_theme_name: filters.themeName ?? null,
          filter_chunk_types: filters.chunkTypes ?? null,
          filter_severity: filters.severity ?? null,
          filter_urgency: filters.urgency ?? null,
          filter_date_from: filters.dateFrom ?? null,
          filter_date_to: filters.dateTo ?? null,
          match_limit: limit,
        }
      );

      if (error) {
        console.error(`${LOG_PREFIX} listSignals — error:`, error.message);
        throw new Error(`Signals listing failed: ${error.message}`);
      }

      const rows: SessionChunkRow[] = (data ?? []).map(
        (row: {
          id: string;
          session_id: string;
          chunk_text: string;
          chunk_type: string;
          metadata: Record<string, unknown> | null;
          client_name: string | null;
          session_date: string | null;
        }) => ({
          id: row.id,
          sessionId: row.session_id,
          chunkText: row.chunk_text,
          chunkType: row.chunk_type,
          // The RPC carries client_name and session_date from the canonical
          // sessions/clients tables. Merge them into metadata so downstream
          // services see them at a stable key without re-querying.
          metadata: {
            ...(row.metadata ?? {}),
            client_name: row.client_name ?? row.metadata?.client_name ?? null,
            session_date: row.session_date ?? row.metadata?.session_date ?? null,
          },
        })
      );

      console.log(`${LOG_PREFIX} listSignals — returning ${rows.length} signals`);
      return rows;
    },
  };
}
