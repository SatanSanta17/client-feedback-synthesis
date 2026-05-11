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

  const rows = await deps.embeddingRepo.listSignals(filters);

  // Date filtering and client name resolution happen via metadata since
  // listSignals returns chunks; we promote the relevant fields out for the
  // model.
  const out: SignalResult[] = [];
  for (const row of rows as SessionChunkRow[]) {
    const meta = row.metadata ?? {};
    const sessionDate = (meta.session_date as string | undefined) ?? "";
    if (filters.dateFrom && sessionDate && sessionDate < filters.dateFrom) {
      continue;
    }
    if (filters.dateTo && sessionDate && sessionDate > filters.dateTo) {
      continue;
    }
    const clientName = (meta.client_name as string | undefined) ?? "Unknown";
    if (
      filters.clientName &&
      clientName.toLowerCase() !== filters.clientName.toLowerCase()
    ) {
      continue;
    }
    const result: SignalResult = {
      sessionId: row.sessionId,
      clientName,
      sessionDate,
      chunkType: row.chunkType,
      text: row.chunkText,
    };
    if (typeof meta.severity === "string") result.severity = meta.severity;
    if (typeof meta.urgency === "string") result.urgency = meta.urgency;
    out.push(result);
  }

  console.log(`${LOG_PREFIX} fetchSignals — returning ${out.length} signals`);
  return out;
}
