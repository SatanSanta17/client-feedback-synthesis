import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";
import type { SessionMeta } from "@/lib/types/embedding-chunk";
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
 * Generates embeddings for a session and persists them.
 *
 * If the session has structured_json, chunks via chunkStructuredSignals().
 * Otherwise, falls back to chunkRawNotes() for raw-only sessions.
 *
 * On re-extraction or re-save: caller should pass isReExtraction=true to
 * delete existing embeddings before generating new ones (P3.R7).
 *
 * Embedding failures are logged but never thrown — this function swallows
 * errors so it can be called fire-and-forget from API routes (P3.R6).
 */
export async function generateSessionEmbeddings(options: {
  sessionMeta: SessionMeta;
  structuredJson: ExtractedSignals | null;
  rawNotes: string;
  embeddingRepo: EmbeddingRepository;
  isReExtraction?: boolean;
}): Promise<void> {
  const {
    sessionMeta,
    structuredJson,
    rawNotes,
    embeddingRepo,
    isReExtraction = false,
  } = options;

  try {
    console.log(
      `[embedding-orchestrator] generateSessionEmbeddings — session: ${sessionMeta.sessionId}, hasStructuredJson: ${structuredJson !== null}, isReExtraction: ${isReExtraction}`
    );

    // Step 1: Delete existing embeddings if re-extracting / re-saving (P3.R7)
    if (isReExtraction) {
      console.log(
        `[embedding-orchestrator] deleting existing embeddings for session: ${sessionMeta.sessionId}`
      );
      await embeddingRepo.deleteBySessionId(sessionMeta.sessionId);
    }

    // Step 2: Chunk — structured JSON takes priority, fallback to raw notes
    const chunks = structuredJson
      ? chunkStructuredSignals(structuredJson, sessionMeta)
      : chunkRawNotes(rawNotes, sessionMeta);

    if (chunks.length === 0) {
      console.log(
        `[embedding-orchestrator] no chunks produced for session: ${sessionMeta.sessionId}, skipping embedding`
      );
      return;
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

    // Step 5: Persist
    await embeddingRepo.upsertChunks(rows);

    console.log(
      `[embedding-orchestrator] generateSessionEmbeddings — success for session: ${sessionMeta.sessionId}, ${rows.length} embeddings stored`
    );
  } catch (err) {
    // Swallow all errors — embedding failure must never block session save (P3.R6)
    console.error(
      `[embedding-orchestrator] generateSessionEmbeddings — failed for session: ${sessionMeta.sessionId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
