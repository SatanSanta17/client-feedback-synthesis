/**
 * Theme Prevention Guard (PRD-026 Part 1)
 *
 * The semantic-similarity backstop that runs before the LLM's "new theme"
 * proposals are honoured. Composed into `assignSessionThemes` as a pre-pass:
 * one batched embedding call per extraction (regardless of how many "new"
 * names the LLM produced), in-memory cosine vs every existing theme's
 * embedding, then a Map<lowerName, decision> the assignment loop consults.
 *
 * Single source of truth for the canonical embedding-text composition
 * (`buildThemeEmbeddingText`) — Part 2's candidate generation and the
 * backfill script must import the same helper.
 */

import { embedTexts } from "@/lib/services/embedding-service";
import type { Theme } from "@/lib/types/theme";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cosine similarity above which a proposed-new theme is collapsed onto an
 * existing one. Conservative by default (PRD-026 P1.R3): bias toward letting
 * duplicates through over collapsing distinct concepts.
 *
 * Sampling on text-embedding-3-small for short topic labels:
 *   - "API Performance" vs "API Speed":     ~0.93–0.96  (collapse — same topic)
 *   - "API Performance" vs "API Latency":   ~0.92–0.94  (collapse — same topic)
 *   - "API Performance" vs "API Cost":      ~0.78–0.84  (keep separate)
 *
 * 0.92 sits at the gap. Tunable via THEME_PREVENTION_SIMILARITY_THRESHOLD;
 * the env-var override exists so production telemetry (P1.R4 logs) can
 * retune without a code deploy.
 */
const DEFAULT_THRESHOLD = 0.92;

const LOG = "[theme-prevention]";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProposedNewTheme {
  name: string;
  description: string | null;
}

export type PreventionDecision =
  | { kind: "reuse"; themeId: string; matchedName: string; score: number }
  | { kind: "new"; embedding: number[]; score: number | null };

export interface PreventionResult {
  /** Keyed by lowercased proposed name. */
  decisions: Map<string, PreventionDecision>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Canonical text used to embed a theme. Single source of truth — the backfill
 * script (`scripts/backfill-theme-embeddings.ts`) and the prevention guard
 * MUST both use this helper. Drift here means the guard compares vectors
 * that came from different text compositions, silently lowering match
 * quality.
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

/**
 * Decides, for each proposed-new theme, whether to reuse an existing theme
 * (semantic match wins) or create a fresh one. Logs every decision with the
 * matched name and similarity score so production telemetry can retune the
 * threshold (P1.R4).
 *
 * The caller (theme-service) handles the case-insensitive exact-name fast
 * path (P1.R6) before invoking this function — anything reaching here is
 * already known not to be an exact match against any existing theme name.
 *
 * Existing themes whose `embedding` is `null` (rollout window between
 * migration 001 and 002, before backfill completes) are skipped from
 * comparison — they cannot match. Once backfill + migration 002 land,
 * the column is NOT NULL and this filter is a no-op.
 *
 * @returns Map keyed by lowercased proposed name. Caller uses the map inside
 *          the assignment loop instead of re-running similarity per signal.
 */
export async function runThemePrevention(input: {
  proposed: ProposedNewTheme[];
  existing: Theme[];
  sessionId: string;
  threshold?: number;
}): Promise<PreventionResult> {
  const { proposed, existing, sessionId } = input;
  const threshold = input.threshold ?? readThresholdFromEnv();

  const decisions = new Map<string, PreventionDecision>();

  if (proposed.length === 0) {
    console.log(`${LOG} no proposed-new themes — skipping`);
    return { decisions };
  }

  const existingWithEmbeddings = existing.filter(
    (t): t is Theme & { embedding: number[] } =>
      Array.isArray(t.embedding) && t.embedding.length > 0
  );

  console.log(
    `${LOG} sessionId: ${sessionId} | proposed: ${proposed.length} | existingWithEmbeddings: ${existingWithEmbeddings.length}/${existing.length} | threshold: ${threshold}`
  );

  // One batched embedding call regardless of how many proposals — P1.R5.
  const proposedTexts = proposed.map((p) =>
    buildThemeEmbeddingText(p.name, p.description)
  );
  const proposedVectors = await embedTexts(proposedTexts);

  if (proposedVectors.length !== proposed.length) {
    throw new Error(
      `${LOG} vector count mismatch: ${proposedVectors.length} vectors for ${proposed.length} proposed themes`
    );
  }

  let reusedCount = 0;
  let newCount = 0;

  for (let i = 0; i < proposed.length; i++) {
    const candidate = proposed[i];
    const candidateVec = proposedVectors[i];
    const lowerName = candidate.name.toLowerCase();

    const best = findBestMatch(candidateVec, existingWithEmbeddings);

    if (best && best.score >= threshold) {
      decisions.set(lowerName, {
        kind: "reuse",
        themeId: best.theme.id,
        matchedName: best.theme.name,
        score: best.score,
      });
      reusedCount++;
      console.log(
        `${LOG} decision — sessionId: ${sessionId} | proposed: "${candidate.name}" | matched: "${best.theme.name}" | score: ${best.score.toFixed(3)} | result: reuse`
      );
    } else {
      decisions.set(lowerName, {
        kind: "new",
        embedding: candidateVec,
        score: best?.score ?? null,
      });
      newCount++;
      console.log(
        `${LOG} decision — sessionId: ${sessionId} | proposed: "${candidate.name}" | matched: ${best ? `"${best.theme.name}"` : "none"} | score: ${best ? best.score.toFixed(3) : "n/a"} | result: new`
      );
    }
  }

  console.log(
    `${LOG} summary — sessionId: ${sessionId} | reused: ${reusedCount} | new: ${newCount} | total: ${proposed.length}`
  );

  return { decisions };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readThresholdFromEnv(): number {
  const raw = process.env.THEME_PREVENTION_SIMILARITY_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD;

  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    console.warn(
      `${LOG} THEME_PREVENTION_SIMILARITY_THRESHOLD="${raw}" is invalid (must be 0..1) — falling back to default ${DEFAULT_THRESHOLD}`
    );
    return DEFAULT_THRESHOLD;
  }
  return parsed;
}

function findBestMatch(
  candidate: number[],
  existing: Array<Theme & { embedding: number[] }>
): { theme: Theme; score: number } | null {
  let best: { theme: Theme; score: number } | null = null;

  for (const theme of existing) {
    const score = cosineSimilarity(candidate, theme.embedding);
    if (!best || score > best.score) {
      best = { theme, score };
    }
  }
  return best;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
