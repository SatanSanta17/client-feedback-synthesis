import { generateObject } from "ai";
import { z } from "zod";

import { resolveModel } from "@/lib/services/ai-service";
import { embedTexts } from "@/lib/services/embedding-service";
import type {
  EmbeddingRepository,
  SimilarityResult,
} from "@/lib/repositories/embedding-repository";
import type { ChunkType } from "@/lib/types/embedding-chunk";
import type {
  ClassificationResult,
  QueryClassification,
  RetrievalOptions,
  RetrievalResult,
} from "@/lib/types/retrieval-result";
import {
  CLASSIFY_QUERY_SYSTEM_PROMPT,
  CLASSIFY_QUERY_MAX_TOKENS,
} from "@/lib/prompts/classify-query";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[retrieval-service]";

const CHUNK_COUNT_MAP: Record<QueryClassification, number> = {
  broad: 15,
  specific: 6,
  comparative: 10,
};

const DEFAULT_SIMILARITY_THRESHOLD = 0.3;

const FALLBACK_CLASSIFICATION: ClassificationResult = { type: "broad" };

// ---------------------------------------------------------------------------
// Classification schema (Zod — used by generateObject)
// ---------------------------------------------------------------------------

const classificationSchema = z.object({
  type: z.enum(["broad", "specific", "comparative"]),
  entities: z.array(z.string()).nullable(),
});

// ---------------------------------------------------------------------------
// Internal: query classification
// ---------------------------------------------------------------------------

/**
 * Classifies a user query to determine retrieval depth.
 * On any failure, falls back to broad (15 chunks) — classification is a
 * "nice to have" optimisation, not a gate.
 */
async function classifyQuery(query: string): Promise<ClassificationResult> {
  const start = Date.now();
  const truncatedQuery = query.length > 100 ? `${query.slice(0, 100)}…` : query;

  try {
    const { model, label } = resolveModel();

    console.log(
      `${LOG_PREFIX} Classifying query, model: ${label}, query: "${truncatedQuery}"`
    );

    const { object } = await generateObject({
      model,
      schema: classificationSchema,
      system: CLASSIFY_QUERY_SYSTEM_PROMPT,
      prompt: query,
      maxOutputTokens: CLASSIFY_QUERY_MAX_TOKENS,
    });

    const result: ClassificationResult = {
      type: object.type,
      ...(object.entities && object.entities.length > 0
        ? { entities: object.entities }
        : {}),
    };

    console.log(
      `${LOG_PREFIX} Classification result: ${JSON.stringify(result)} (${Date.now() - start}ms)`
    );

    return result;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown classification error";

    console.error(
      `${LOG_PREFIX} Classification failed, falling back to broad. Error: ${message} (${Date.now() - start}ms)`
    );

    return FALLBACK_CLASSIFICATION;
  }
}

// ---------------------------------------------------------------------------
// Internal: deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicates results by exact chunk text match.
 * If the same text appears from multiple sessions, only the highest-scoring
 * instance survives. Re-sorts after deduplication to maintain descending
 * similarity order.
 */
function deduplicateResults(results: SimilarityResult[]): SimilarityResult[] {
  const seen = new Map<string, SimilarityResult>();

  for (const result of results) {
    const existing = seen.get(result.chunkText);
    if (!existing || result.similarityScore > existing.similarityScore) {
      seen.set(result.chunkText, result);
    }
  }

  return Array.from(seen.values()).sort(
    (a, b) => b.similarityScore - a.similarityScore
  );
}

// ---------------------------------------------------------------------------
// Internal: mapping
// ---------------------------------------------------------------------------

/**
 * Maps a repository-layer SimilarityResult to the public RetrievalResult
 * interface. Promotes clientName and sessionDate from metadata to top-level
 * fields for consumer convenience.
 */
function toRetrievalResult(result: SimilarityResult): RetrievalResult {
  return {
    chunkText: result.chunkText,
    similarityScore: result.similarityScore,
    sessionId: result.sessionId,
    clientName: (result.metadata.client_name as string) ?? "Unknown",
    sessionDate: (result.metadata.session_date as string) ?? "",
    chunkType: result.chunkType as ChunkType,
    metadata: result.metadata,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieves relevant embedding chunks for a natural-language query.
 *
 * Flow:
 *   1. Classify the query (LLM call) → determines chunk count.
 *   2. Embed the query (embedding service) → produces query vector.
 *   3. Similarity search (embedding repository RPC) → ranked chunks.
 *   4. Deduplicate by exact chunk text → highest score wins.
 *   5. Map to RetrievalResult[] → return to caller.
 *
 * Classification errors are swallowed (falls back to broad).
 * Embedding and search errors propagate to the caller.
 *
 * Framework-agnostic: no imports from next/server or HTTP concepts.
 */
export async function retrieveRelevantChunks(
  query: string,
  options: RetrievalOptions,
  embeddingRepo: EmbeddingRepository
): Promise<RetrievalResult[]> {
  console.log(
    `${LOG_PREFIX} Starting retrieval, teamId: ${options.teamId ?? "personal"}, filters: ${JSON.stringify({
      chunkTypes: options.chunkTypes,
      clientName: options.clientName,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    })}`
  );

  // 1. Classify
  const classification = await classifyQuery(query);
  const resolvedMaxChunks =
    options.maxChunks ?? CHUNK_COUNT_MAP[classification.type];

  console.log(
    `${LOG_PREFIX} Query classified as "${classification.type}", fetching up to ${resolvedMaxChunks} chunks`
  );

  // 2. Embed the query
  const [queryEmbedding] = await embedTexts([query]);

  console.log(`${LOG_PREFIX} Query embedded, vector length: ${queryEmbedding.length}`);

  // 3. Similarity search
  const rawResults = await embeddingRepo.similaritySearch(queryEmbedding, {
    teamId: options.teamId,
    maxResults: resolvedMaxChunks,
    chunkTypes: options.chunkTypes,
    clientName: options.clientName,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  });

  console.log(
    `${LOG_PREFIX} Similarity search returned ${rawResults.length} results`
  );

  // 4. Deduplicate
  const deduped = deduplicateResults(rawResults);
  if (deduped.length < rawResults.length) {
    console.log(
      `${LOG_PREFIX} Deduplicated ${rawResults.length} → ${deduped.length} results`
    );
  }

  // 5. Map to RetrievalResult[]
  const results = deduped.map(toRetrievalResult);

  console.log(
    `${LOG_PREFIX} Retrieval complete, returning ${results.length} results`
  );

  return results;
}
