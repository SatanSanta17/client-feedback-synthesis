import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  EmbeddingRepository,
  EmbeddingRow,
  SearchOptions,
  SimilarityResult,
} from "../embedding-repository";

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
        `[supabase-embedding-repo] upsertChunks — ${chunks.length} chunks for session: ${sessionId}`
      );

      // Serialise embedding arrays to Postgres vector format string
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
          `[supabase-embedding-repo] upsertChunks — error for session ${sessionId}:`,
          error.message
        );
        throw new Error(`Failed to insert embeddings: ${error.message}`);
      }

      const ids = (data ?? []).map((row: { id: string }) => row.id);

      console.log(
        `[supabase-embedding-repo] upsertChunks — success, ${ids.length} chunks inserted for session: ${sessionId}`
      );

      return ids;
    },

    async deleteBySessionId(sessionId: string): Promise<void> {
      console.log(
        `[supabase-embedding-repo] deleteBySessionId — session: ${sessionId}`
      );

      const { error } = await serviceClient
        .from("session_embeddings")
        .delete()
        .eq("session_id", sessionId);

      if (error) {
        console.error(
          `[supabase-embedding-repo] deleteBySessionId — error for session ${sessionId}:`,
          error.message
        );
        throw new Error(
          `Failed to delete embeddings for session ${sessionId}: ${error.message}`
        );
      }

      console.log(
        `[supabase-embedding-repo] deleteBySessionId — success for session: ${sessionId}`
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
        `[supabase-embedding-repo] similaritySearch — teamId: ${teamId}, maxResults: ${maxResults}, chunkTypes: ${chunkTypes?.join(",") ?? "all"}, threshold: ${similarityThreshold}`
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
          "[supabase-embedding-repo] similaritySearch — error:",
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
        `[supabase-embedding-repo] similaritySearch — returning ${results.length} results`
      );

      return results;
    },
  };
}
