// ---------------------------------------------------------------------------
// Token estimator — chars/4 proxy.
// PRD-033 P1.R2 / TRD § 1.3.
//
// Accuracy: ±20% vs the true tokenizer count for English prose.
// Underestimates for code / symbol-heavy text; overestimates for whitespace-
// heavy text. The fetch-content token budget (50k initial) is approximate by
// design — this proxy is the trade-off. Real tokenizers (tiktoken / Anthropic
// countTokens / Google) are deferred until eval shows budget mis-estimation
// is costing real money or coverage. Every consumer (fetch_session_content
// budgeting in Part 1, summarise_sessions fan-out in Part 2, per-turn cost
// circuit breaker in Part 3) inherits this ±20% characteristic.
// ---------------------------------------------------------------------------

export function estimateTokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(s.length / 4);
}
