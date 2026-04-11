import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";
import type {
  ChunkType,
  EmbeddingChunk,
  SessionMeta,
} from "@/lib/types/embedding-chunk";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Constructs the base metadata present on every chunk: client_name and session_date.
 */
function buildBaseMetadata(
  meta: SessionMeta
): Record<string, unknown> {
  return {
    client_name: meta.clientName,
    session_date: meta.sessionDate,
  };
}

/**
 * Returns a new object with all null and undefined values removed.
 * Keeps metadata clean for downstream filtering and display.
 */
function omitNullValues(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Creates a single EmbeddingChunk with common fields filled from SessionMeta.
 */
function buildChunk(
  chunkText: string,
  chunkType: ChunkType,
  metadata: Record<string, unknown>,
  meta: SessionMeta
): EmbeddingChunk {
  return {
    chunkText,
    chunkType,
    metadata: omitNullValues({ ...buildBaseMetadata(meta), ...metadata }),
    sessionId: meta.sessionId,
    teamId: meta.teamId,
    schemaVersion: meta.schemaVersion,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transforms a session's structured extraction JSON into an array of typed,
 * metadata-rich chunks ready for embedding. Pure function — no database access,
 * no API calls, no side effects.
 */
export function chunkStructuredSignals(
  structuredJson: ExtractedSignals,
  sessionMeta: SessionMeta
): EmbeddingChunk[] {
  const chunks: EmbeddingChunk[] = [];

  // --- Summary (always exactly 1 chunk) ---
  chunks.push(
    buildChunk(structuredJson.summary, "summary", {}, sessionMeta)
  );

  // --- Client profile (skip if all fields null) ---
  const { industry, geography, budgetRange } = structuredJson.clientProfile;
  if (industry !== null || geography !== null || budgetRange !== null) {
    const parts: string[] = [];
    if (industry !== null) parts.push(`Industry: ${industry}.`);
    if (geography !== null) parts.push(`Geography: ${geography}.`);
    if (budgetRange !== null) parts.push(`Budget range: ${budgetRange}.`);

    chunks.push(
      buildChunk(parts.join(" "), "client_profile", {
        industry,
        geography,
        budget_range: budgetRange,
      }, sessionMeta)
    );
  }

  // --- Pain points (one per item) ---
  for (const item of structuredJson.painPoints) {
    chunks.push(
      buildChunk(item.text, "pain_point", {
        severity: item.severity,
        client_quote: item.clientQuote,
      }, sessionMeta)
    );
  }

  // --- Requirements (one per item) ---
  for (const item of structuredJson.requirements) {
    chunks.push(
      buildChunk(item.text, "requirement", {
        severity: item.severity,
        priority: item.priority,
        client_quote: item.clientQuote,
      }, sessionMeta)
    );
  }

  // --- Aspirations (one per item) ---
  for (const item of structuredJson.aspirations) {
    chunks.push(
      buildChunk(item.text, "aspiration", {
        severity: item.severity,
        client_quote: item.clientQuote,
      }, sessionMeta)
    );
  }

  // --- Competitive mentions (one per item) ---
  for (const item of structuredJson.competitiveMentions) {
    chunks.push(
      buildChunk(item.context, "competitive_mention", {
        competitor: item.competitor,
        sentiment: item.sentiment,
      }, sessionMeta)
    );
  }

  // --- Blockers (one per item) ---
  for (const item of structuredJson.blockers) {
    chunks.push(
      buildChunk(item.text, "blocker", {
        severity: item.severity,
        client_quote: item.clientQuote,
      }, sessionMeta)
    );
  }

  // --- Tools & platforms (one per item) ---
  for (const item of structuredJson.toolsAndPlatforms) {
    chunks.push(
      buildChunk(item.context, "tool_and_platform", {
        name: item.name,
        type: item.type,
      }, sessionMeta)
    );
  }

  // --- Custom categories (one chunk per signal in each category) ---
  for (const category of structuredJson.custom) {
    for (const signal of category.signals) {
      chunks.push(
        buildChunk(signal.text, "custom", {
          category_name: category.categoryName,
          severity: signal.severity,
          client_quote: signal.clientQuote,
        }, sessionMeta)
      );
    }
  }

  return chunks;
}

/**
 * Splits raw notes into paragraph-level chunks for sessions that have no
 * structured_json. Pure function — no database access, no API calls.
 */
export function chunkRawNotes(
  rawNotes: string,
  sessionMeta: SessionMeta
): EmbeddingChunk[] {
  return rawNotes
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) =>
      buildChunk(paragraph, "raw", {}, sessionMeta)
    );
}
