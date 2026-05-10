// ---------------------------------------------------------------------------
// Retrieval config — env-overridable constants for the hybrid retrieval path.
// PRD-033 P1.R2 / TRD § 1.3. The eval set in P1.R9 is the source of truth for
// tuning these.
// ---------------------------------------------------------------------------

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function floatFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const RAG_VECTOR_TOP_N = intFromEnv("RAG_VECTOR_TOP_N", 30);
export const RAG_FTS_TOP_N = intFromEnv("RAG_FTS_TOP_N", 30);
export const RAG_RRF_K = intFromEnv("RAG_RRF_K", 60);
export const RAG_VECTOR_WEIGHT = floatFromEnv("RAG_VECTOR_WEIGHT", 1.0);
export const RAG_FTS_WEIGHT = floatFromEnv("RAG_FTS_WEIGHT", 1.0);
export const RAG_FINAL_TOP_N = intFromEnv("RAG_FINAL_TOP_N", 10);
