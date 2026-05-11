import { generateObject } from "ai";
import { z } from "zod";

import { resolveModel } from "@/lib/services/ai-service";
import { embedTexts } from "@/lib/services/embedding-service";
import type {
  EmbeddingRepository,
  FtsResult,
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
import { rrfFuse, type RrfSource } from "@/lib/services/retrieval-rrf";
import {
  RAG_FTS_TOP_N,
  RAG_FTS_WEIGHT,
  RAG_RRF_K,
  RAG_VECTOR_TOP_N,
  RAG_VECTOR_WEIGHT,
} from "@/lib/services/retrieval-config";

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
// Internal: deduplication (used post-fusion, after both lists merged)
// ---------------------------------------------------------------------------

interface FusedRow {
  id: string;
  sessionId: string;
  chunkText: string;
  chunkType: string;
  metadata: Record<string, unknown>;
  similarityScore: number;
  sources: RrfSource[];
}

function deduplicateByText(rows: FusedRow[]): FusedRow[] {
  const seen = new Map<string, FusedRow>();
  for (const row of rows) {
    const existing = seen.get(row.chunkText);
    if (!existing || row.similarityScore > existing.similarityScore) {
      seen.set(row.chunkText, row);
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => b.similarityScore - a.similarityScore
  );
}

function toRetrievalResult(row: FusedRow): RetrievalResult {
  return {
    chunkText: row.chunkText,
    similarityScore: row.similarityScore,
    sessionId: row.sessionId,
    clientName: (row.metadata.client_name as string) ?? "Unknown",
    sessionDate: (row.metadata.session_date as string) ?? "",
    chunkType: row.chunkType as ChunkType,
    metadata: row.metadata,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieves relevant embedding chunks for a natural-language query.
 *
 * Hybrid retrieval (PRD-033 P1.R2): runs vector similarity search and Postgres
 * full-text search in parallel, then fuses both ranked lists via reciprocal
 * rank fusion (RRF). Closes the gap where pure-vector misses exact-term
 * queries ("Snowflake") and pure-keyword misses semantic paraphrase
 * ("onboarding pain" ↔ "first-time setup is confusing").
 *
 * Flow:
 *   1. Classify the query (LLM call) → determines per-side top-N override.
 *   2. Embed the query (embedding service).
 *   3. Run similaritySearch + fullTextSearch in parallel.
 *   4. Fuse via RRF using the embedding row id as the join key.
 *   5. Deduplicate by exact chunk text → highest score wins.
 *   6. Map to RetrievalResult[] → return.
 *
 * Classification errors are swallowed (fall back to broad).
 * Embedding and search errors propagate to the caller.
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

  // 1. Classify — controls finalTopN for backwards compat with the existing
  //    chat surface, which expects 6/10/15 results based on classification.
  const classification = await classifyQuery(query);
  const finalTopN = options.maxChunks ?? CHUNK_COUNT_MAP[classification.type];

  console.log(
    `${LOG_PREFIX} Query classified as "${classification.type}", finalTopN: ${finalTopN}`
  );

  // 2. Embed
  const [queryEmbedding] = await embedTexts([query]);

  console.log(
    `${LOG_PREFIX} Query embedded, vector length: ${queryEmbedding.length}`
  );

  // 3. Parallel vector + FTS search
  const [vectorResults, ftsResults] = await Promise.all([
    embeddingRepo.similaritySearch(queryEmbedding, {
      teamId: options.teamId,
      maxResults: RAG_VECTOR_TOP_N,
      chunkTypes: options.chunkTypes,
      clientName: options.clientName,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
    }),
    embeddingRepo.fullTextSearch(query, {
      teamId: options.teamId,
      maxResults: RAG_FTS_TOP_N,
      chunkTypes: options.chunkTypes,
      clientName: options.clientName,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    }),
  ]);

  console.log(
    `${LOG_PREFIX} Hybrid retrieval — vector: ${vectorResults.length}, fts: ${ftsResults.length}`
  );

  // 4. RRF fusion. We use embedding row id as the cross-list join key.
  type Joinable = { id: string };
  const fused = rrfFuse<Joinable>(
    vectorResults as unknown as (SimilarityResult & Joinable)[],
    ftsResults as unknown as (FtsResult & Joinable)[],
    (row) => row.id,
    {
      k: RAG_RRF_K,
      vectorWeight: RAG_VECTOR_WEIGHT,
      ftsWeight: RAG_FTS_WEIGHT,
      finalTopN,
    }
  );

  // Resolve the full row (chunk text, metadata, etc.) from whichever list
  // yielded it — both lists carry the same payload, prefer vector for the
  // similarityScore where present.
  const vectorById = new Map(vectorResults.map((r) => [r.id, r]));
  const ftsById = new Map(ftsResults.map((r) => [r.id, r]));

  const fusedRows: FusedRow[] = fused.map((entry) => {
    const id = (entry.row as Joinable).id;
    const v = vectorById.get(id);
    const f = ftsById.get(id);
    const source = v ?? f;
    if (!source) {
      throw new Error(`RRF produced an id (${id}) absent from both source lists`);
    }
    return {
      id: source.id,
      sessionId: source.sessionId,
      chunkText: source.chunkText,
      chunkType: source.chunkType,
      metadata: source.metadata,
      similarityScore: entry.rrfScore,
      sources: entry.sources,
    };
  });

  // 5. Deduplicate by exact text
  const deduped = deduplicateByText(fusedRows);
  if (deduped.length < fusedRows.length) {
    console.log(
      `${LOG_PREFIX} Deduplicated ${fusedRows.length} → ${deduped.length} results`
    );
  }

  // Telemetry: how many of the final results came from each source?
  const fromVector = deduped.filter((r) => r.sources.includes("vector")).length;
  const fromFts = deduped.filter((r) => r.sources.includes("fts")).length;
  const fromBoth = deduped.filter(
    (r) => r.sources.includes("vector") && r.sources.includes("fts")
  ).length;
  console.log(
    `${LOG_PREFIX} RRF source distribution — vector: ${fromVector}, fts: ${fromFts}, both: ${fromBoth} (final: ${deduped.length})`
  );

  // Cap at finalTopN one more time — dedup may have shrunk the list, but
  // never expanded it. Finally map.
  const results = deduped.slice(0, finalTopN).map(toRetrievalResult);

  console.log(
    `${LOG_PREFIX} Retrieval complete, returning ${results.length} results`
  );

  return results;
}
