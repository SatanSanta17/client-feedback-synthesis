/**
 * Theme Prevention Guard (PRD-026 Part 1)
 *
 * Increment 1.2 introduces only the shared embedding-text composition helper.
 * Increment 1.3 will add `runThemePrevention()` and the cosine similarity
 * machinery alongside it — keeping a single file means Part 2's candidate
 * generation imports one module for both helpers.
 */

/**
 * Canonical text used to embed a theme. Single source of truth — the backfill
 * script (`scripts/backfill-theme-embeddings.ts`) and the prevention guard
 * (Increment 1.3) MUST both use this helper. Drift here means the guard
 * compares vectors that came from different text compositions, silently
 * lowering match quality.
 *
 * Format: `name\n\ndescription` with description coalesced to empty when null,
 * trimmed to drop the trailing newlines for description-less themes.
 */
export function buildThemeEmbeddingText(
  name: string,
  description: string | null
): string {
  return `${name}\n\n${description ?? ""}`.trim();
}
