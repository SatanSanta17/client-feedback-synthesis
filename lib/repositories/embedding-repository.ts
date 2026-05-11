// ---------------------------------------------------------------------------
// Embedding Repository Interface
// ---------------------------------------------------------------------------

import type { ChunkType } from "@/lib/types/embedding-chunk";

export interface EmbeddingRow {
  id?: string;
  session_id: string;
  team_id: string | null;
  chunk_text: string;
  chunk_type: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  schema_version: number;
}

export interface SearchOptions {
  teamId: string | null;
  maxResults: number;
  chunkTypes?: string[];
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  similarityThreshold?: number;
}

export interface FtsSearchOptions {
  teamId: string | null;
  maxResults: number;
  chunkTypes?: string[];
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SimilarityResult {
  id: string;
  sessionId: string;
  chunkText: string;
  chunkType: string;
  metadata: Record<string, unknown>;
  similarityScore: number;
}

export interface FtsResult {
  id: string;
  sessionId: string;
  chunkText: string;
  chunkType: string;
  metadata: Record<string, unknown>;
  ftsRank: number;
}

/**
 * Filters used by the new fetch_signals tool (PRD-033 P1.R2). Strictly
 * schema-driven — no query string, no similarity ranking. Returns every
 * chunk that satisfies the AND of all provided filters.
 */
export interface SignalFilters {
  teamId: string | null;
  userId?: string;
  clientName?: string;
  themeName?: string;
  chunkTypes?: ChunkType[];
  severity?: "low" | "medium" | "high";
  urgency?: "low" | "medium" | "high" | "critical";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

/**
 * Lightweight chunk shape for fetch_session_content. Omits the embedding
 * vector (large, irrelevant to the model) but keeps the metadata that
 * carries severity / urgency / etc. for the chunk.
 */
export interface SessionChunkRow {
  id: string;
  sessionId: string;
  chunkText: string;
  chunkType: string;
  metadata: Record<string, unknown>;
}

export interface EmbeddingRepository {
  /** Bulk insert embedding rows. Returns the IDs of inserted rows. */
  upsertChunks(chunks: EmbeddingRow[]): Promise<string[]>;

  /** Delete all embeddings for a session (used before re-embedding). */
  deleteBySessionId(sessionId: string): Promise<void>;

  /** Cosine similarity search with metadata filtering. Returns chunks ranked by similarity. */
  similaritySearch(
    queryEmbedding: number[],
    options: SearchOptions
  ): Promise<SimilarityResult[]>;

  /**
   * Postgres full-text search via match_session_embeddings_fts RPC.
   * PRD-033 P1.R2 — fused with similaritySearch via RRF in retrieval-service.
   */
  fullTextSearch(
    queryText: string,
    options: FtsSearchOptions
  ): Promise<FtsResult[]>;

  /**
   * Fetch all chunks for the given session ids, workspace-scoped.
   * Used by fetch_session_content (PRD-033 P1.R2).
   */
  fetchBySessionIds(
    sessionIds: string[],
    options: { teamId: string | null; userId?: string }
  ): Promise<SessionChunkRow[]>;

  /**
   * Filter-driven signal listing. Used by fetch_signals (PRD-033 P1.R2).
   * Joins through signal_themes when themeName is provided.
   */
  listSignals(filters: SignalFilters): Promise<SessionChunkRow[]>;
}
