import type { ChunkType } from "@/lib/types/embedding-chunk";

/* ------------------------------------------------------------------ */
/*  Query classification                                               */
/* ------------------------------------------------------------------ */

/**
 * Classification of a user query to determine retrieval depth.
 *
 * - broad:       General questions about patterns, trends, or aggregates (15 chunks).
 * - specific:    Questions about a particular client, topic, or narrow subject (6 chunks).
 * - comparative: Questions comparing two or more entities (10 chunks).
 */
export type QueryClassification = "broad" | "specific" | "comparative";

/**
 * Structured output from the query classification LLM call.
 */
export interface ClassificationResult {
  type: QueryClassification;
  entities?: string[];
}

/* ------------------------------------------------------------------ */
/*  Retrieval options                                                   */
/* ------------------------------------------------------------------ */

/**
 * Options for the retrieval service.
 */
export interface RetrievalOptions {
  /** Required — scopes search to the user's current workspace. */
  teamId: string | null;
  /** Optional — override the adaptive chunk count. */
  maxChunks?: number;
  /** Optional — filter by specific chunk types. */
  chunkTypes?: ChunkType[];
  /** Optional — filter by client name (exact match). */
  clientName?: string;
  /** Optional — filter by date range start (inclusive, ISO date string). */
  dateFrom?: string;
  /** Optional — filter by date range end (inclusive, ISO date string). */
  dateTo?: string;
}

/* ------------------------------------------------------------------ */
/*  Retrieval result                                                   */
/* ------------------------------------------------------------------ */

/**
 * A single retrieval result with similarity score and full metadata.
 * Consumed by PRD-020 (RAG Chat) and PRD-021 (AI Insights Dashboard).
 */
export interface RetrievalResult {
  chunkText: string;
  similarityScore: number;
  sessionId: string;
  clientName: string;
  sessionDate: string;
  chunkType: ChunkType;
  metadata: Record<string, unknown>;
}
