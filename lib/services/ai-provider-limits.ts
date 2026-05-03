/**
 * Provider/model output-token caps (PRD-031 Part 3 P3.R5).
 *
 * Defensive helper that clamps a desired `maxOutputTokens` value to a known
 * provider/model maximum at runtime. Defends against ops switching `AI_MODEL`
 * to a smaller-cap variant without remembering to lower the chat cap.
 *
 * Map keys match the `label` shape returned by `resolveModel()` in
 * `ai-service.ts` — `${provider}/${modelId}`. Entries are conservative known
 * floors; unlisted provider/models return the desired value unchanged (no
 * clamp, no warn) so a new model with a higher cap is not over-restricted.
 *
 * The map is intentionally provider/model-keyed (not just provider-keyed)
 * because cap varies by model within a provider — Gemini Flash variants cap
 * at 8192 while Gemini Pro variants go higher.
 *
 * Add a new entry only when a configured provider/model has a known output
 * cap *below* the highest cap we ask for in any non-streaming or streaming
 * call site. The current chat call site asks for 8192 (PRD-031 P3.R1); the
 * non-streaming `callModelObject` / `callModelText` call sites ask for at
 * most 8192 (master signal synthesis). Models with caps ≥ 8192 don't need
 * an entry.
 */

const LOG_PREFIX = "[ai-provider-limits]";

const PROVIDER_OUTPUT_CAPS: Record<string, number> = {
  // Google Gemini Flash variants — 8192 output cap.
  "google/gemini-2.0-flash": 8192,
  "google/gemini-2.0-flash-lite": 8192,
  "google/gemini-1.5-flash": 8192,
  // OpenAI gpt-4o / gpt-4o-mini support 16384 output — not listed (≥ desired).
  // Anthropic Claude Sonnet / Opus / Haiku 4.x family ≥ 32768 — not listed.
};

/**
 * Returns `Math.min(desired, knownMax)` for the given model label, or
 * `desired` unchanged if the model is unlisted. Logs a warning when a clamp
 * fires so ops can see post-deploy that a configured model is forcing a
 * smaller cap than the call site asked for.
 */
export function clampOutputTokens(
  desired: number,
  modelLabel: string
): number {
  const cap = PROVIDER_OUTPUT_CAPS[modelLabel];
  if (cap === undefined) return desired;
  if (desired <= cap) return desired;

  console.warn(
    `${LOG_PREFIX} clamping output cap for ${modelLabel}: ${desired} → ${cap}`
  );
  return cap;
}
