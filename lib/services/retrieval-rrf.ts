// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion — pure function used to merge two ranked lists
// (vector + FTS) into one. Cormack et al. 2009; default k=60.
// PRD-033 / TRD § 1.3.
// ---------------------------------------------------------------------------

export interface RrfConfig {
  k: number;
  vectorWeight: number;
  ftsWeight: number;
  finalTopN: number;
}

export type RrfSource = "vector" | "fts";

export interface RrfFused<T> {
  row: T;
  rrfScore: number;
  sources: RrfSource[];
}

/**
 * Merges two ranked lists into a single RRF-ranked list.
 *
 * Each input is treated as already-ranked (index 0 is rank 1). For each item,
 * the contribution to the final score is `weight / (k + rank)`. Items that
 * appear in both lists accumulate contributions from both sides.
 *
 * The `keyFn` projects the row to a string id for cross-list matching — pass
 * `(row) => row.id` for embedding rows (both RPCs return the same `id`).
 *
 * Returns a new array sorted by rrfScore desc, capped at `finalTopN`.
 */
export function rrfFuse<T>(
  vectorList: T[],
  ftsList: T[],
  keyFn: (row: T) => string,
  cfg: RrfConfig
): RrfFused<T>[] {
  const acc = new Map<
    string,
    { row: T; score: number; sources: Set<RrfSource> }
  >();

  const contribute = (
    list: T[],
    weight: number,
    source: RrfSource
  ): void => {
    list.forEach((row, i) => {
      const key = keyFn(row);
      const rank = i + 1;
      const contribution = weight / (cfg.k + rank);
      const existing = acc.get(key);
      if (existing) {
        existing.score += contribution;
        existing.sources.add(source);
      } else {
        acc.set(key, {
          row,
          score: contribution,
          sources: new Set([source]),
        });
      }
    });
  };

  contribute(vectorList, cfg.vectorWeight, "vector");
  contribute(ftsList, cfg.ftsWeight, "fts");

  return [...acc.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.finalTopN)
    .map((entry) => ({
      row: entry.row,
      rrfScore: entry.score,
      sources: [...entry.sources],
    }));
}
