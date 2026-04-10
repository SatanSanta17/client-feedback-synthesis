/**
 * Valid chunk type values — matches chunk_type TEXT column in session_embeddings.
 * Stored as text in Postgres (not enum) for extensibility without migration.
 */
export type ChunkType =
  | "summary"
  | "client_profile"
  | "pain_point"
  | "requirement"
  | "aspiration"
  | "competitive_mention"
  | "blocker"
  | "tool_and_platform"
  | "custom"
  | "raw";

/**
 * A single embeddable chunk ready for the embedding pipeline.
 * Produced by the chunking service, consumed by the embedding service (Part 3).
 */
export interface EmbeddingChunk {
  chunkText: string;
  chunkType: ChunkType;
  metadata: Record<string, unknown>;
  sessionId: string;
  teamId: string | null;
  schemaVersion: number;
}

/**
 * Session metadata needed by the chunking service.
 * Passed in by the caller — the chunking service has no database access.
 */
export interface SessionMeta {
  sessionId: string;
  clientName: string;
  sessionDate: string;
  teamId: string | null;
  schemaVersion: number;
}
