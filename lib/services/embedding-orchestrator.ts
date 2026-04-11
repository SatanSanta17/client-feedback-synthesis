import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";
import type { EmbeddingChunk, SessionMeta } from "@/lib/types/embedding-chunk";
import type {
  EmbeddingRepository,
  EmbeddingRow,
} from "@/lib/repositories/embedding-repository";
import {
  chunkStructuredSignals,
  chunkRawNotes,
} from "@/lib/services/chunking-service";
import { embedTexts } from "@/lib/services/embedding-service";

/**
 * Options for embedding generation, with optional pre-computed chunks.
 */
export interface GenerateSessionEmbeddingsOptions {
  sessionMeta: SessionMeta;
  structuredJson: ExtractedSignals | null;
  rawNotes: string;
  embeddingRepo: EmbeddingRepository;
  isReExtraction?: boolean;
  /** Pre-computed chunks to skip internal chunking. Used when the caller
   *  needs the same chunks for downstream processing (e.g., theme assignment). */
  preComputedChunks?: EmbeddingChunk[];
}

/**
 * Generates embeddings for a session and persists them.
 *
 * If the session has structured_json, chunks via chunkStructuredSignals().
 * Otherwise, falls back to chunkRawNotes() for raw-only sessions.
 * If preComputedChunks is provided, internal chunking is skipped.
 *
 * On re-extraction or re-save: caller should pass isReExtraction=true to
 * delete existing embeddings before generating new ones (P3.R7).
 *
 * Returns the IDs of the inserted embedding rows on success, or an empty
 * array on failure. The caller (session routes) chains theme assignment
 * after this function using the returned IDs.
 */
export async function generateSessionEmbeddings(
  options: GenerateSessionEmbeddingsOptions
): Promise<string[]> {
  const {
    sessionMeta,
    structuredJson,
    rawNotes,
    embeddingRepo,
    isReExtraction = false,
    preComputedChunks,
  } = options;

  try {
    console.log(
      `[embedding-orchestrator] generateSessionEmbeddings — session: ${sessionMeta.sessionId}, hasStructuredJson: ${structuredJson !== null}, isReExtraction: ${isReExtraction}, preComputedChunks: ${preComputedChunks ? preComputedChunks.length : "none"}`
    );

    // Step 1: Delete existing embeddings if re-extracting / re-saving (P3.R7)
    if (isReExtraction) {
      console.log(
        `[embedding-orchestrator] deleting existing embeddings for session: ${sessionMeta.sessionId}`
      );
      await embeddingRepo.deleteBySessionId(sessionMeta.sessionId);
    }

    // Step 2: Chunk — use pre-computed if available, otherwise compute
    const chunks = preComputedChunks
      ?? (structuredJson
        ? chunkStructuredSignals(structuredJson, sessionMeta)
        : chunkRawNotes(rawNotes, sessionMeta));

    if (chunks.length === 0) {
      console.log(
        `[embedding-orchestrator] no chunks produced for session: ${sessionMeta.sessionId}, skipping embedding`
      );
      return [];
    }

    console.log(
      `[embedding-orchestrator] chunked session ${sessionMeta.sessionId}: ${chunks.length} chunks (types: ${[...new Set(chunks.map((c) => c.chunkType))].join(", ")})`
    );

    // Step 3: Embed all chunk texts
    const texts = chunks.map((c) => c.chunkText);
    const embeddings = await embedTexts(texts);

    // Step 4: Map chunks + vectors into EmbeddingRow[]
    const rows: EmbeddingRow[] = chunks.map((chunk, i) => ({
      session_id: chunk.sessionId,
      team_id: chunk.teamId,
      chunk_text: chunk.chunkText,
      chunk_type: chunk.chunkType,
      metadata: chunk.metadata,
      embedding: embeddings[i],
      schema_version: chunk.schemaVersion,
    }));

    // Step 5: Persist and capture IDs
    const embeddingIds = await embeddingRepo.upsertChunks(rows);

    console.log(
      `[embedding-orchestrator] generateSessionEmbeddings — success for session: ${sessionMeta.sessionId}, ${embeddingIds.length} embeddings stored`
    );

    return embeddingIds;
  } catch (err) {
    // Swallow all errors — embedding failure must never block session save (P3.R6)
    console.error(
      `[embedding-orchestrator] generateSessionEmbeddings — failed for session: ${sessionMeta.sessionId}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
