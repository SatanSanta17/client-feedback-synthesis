// ---------------------------------------------------------------------------
// Embedding Repository Interface
// ---------------------------------------------------------------------------

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

export interface SimilarityResult {
  id: string;
  sessionId: string;
  chunkText: string;
  chunkType: string;
  metadata: Record<string, unknown>;
  similarityScore: number;
}

export interface EmbeddingRepository {
  /** Bulk insert embedding rows. */
  upsertChunks(chunks: EmbeddingRow[]): Promise<void>;

  /** Delete all embeddings for a session (used before re-embedding). */
  deleteBySessionId(sessionId: string): Promise<void>;

  /** Cosine similarity search with metadata filtering. Returns chunks ranked by similarity. */
  similaritySearch(
    queryEmbedding: number[],
    options: SearchOptions
  ): Promise<SimilarityResult[]>;
}
