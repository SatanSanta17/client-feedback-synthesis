// ---------------------------------------------------------------------------
// Signals Service — backs fetch_signals tool.
// PRD-033 P1.R2 / TRD § 1.3.
// Strictly schema-filtered (no query string). Distinct from semantic_search:
// completeness, not similarity.
// ---------------------------------------------------------------------------

import type {
  EmbeddingRepository,
  SessionChunkRow,
  SignalFilters,
} from "@/lib/repositories/embedding-repository";

const LOG_PREFIX = "[signals-service]";

export interface SignalResult {
  /**
   * Included for citation plumbing in the chat surface — system prompt v2
   * instructs the model not to mention UUIDs in its reply.
   */
  sessionId: string;
  clientName: string;
  sessionDate: string;
  chunkType: string;
  text: string;
  severity?: string;
  urgency?: string;
}

export async function fetchSignals(
  filters: SignalFilters,
  deps: { embeddingRepo: EmbeddingRepository }
): Promise<SignalResult[]> {
  console.log(`${LOG_PREFIX} fetchSignals — ${JSON.stringify(filters)}`);

  // All filters (client / date / theme / chunkTypes / severity / urgency)
  // are applied at SQL by the repo's RPC. No post-filtering needed —
  // the result is already complete and capped at `limit`. PRD-033 P1.R5.
  const rows = await deps.embeddingRepo.listSignals(filters);

  const out: SignalResult[] = (rows as SessionChunkRow[]).map((row) => {
    const meta = row.metadata ?? {};
    const result: SignalResult = {
      sessionId: row.sessionId,
      clientName: (meta.client_name as string | undefined) ?? "Unknown",
      sessionDate: (meta.session_date as string | undefined) ?? "",
      chunkType: row.chunkType,
      text: row.chunkText,
    };
    if (typeof meta.severity === "string") result.severity = meta.severity;
    if (typeof meta.urgency === "string") result.urgency = meta.urgency;
    return result;
  });

  console.log(`${LOG_PREFIX} fetchSignals — returning ${out.length} signals`);
  return out;
}
