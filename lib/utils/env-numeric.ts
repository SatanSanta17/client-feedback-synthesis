/**
 * Reads a numeric environment variable with bounds + kind validation.
 *
 * Replaces the per-service `readXFromEnv` helpers that accumulated across
 * PRD-026 Parts 1, 2, and 4 (PRD-026 P4 audit Fix A). Each call site picks
 * its kind ("int" or "float") and bounds; on failure the helper logs a
 * single warning under the caller's `logPrefix` and returns `fallback`.
 *
 * @example
 *   const threshold = readNumericEnv(
 *     "THEME_PREVENTION_SIMILARITY_THRESHOLD",
 *     0.92,
 *     { min: 0, max: 1, logPrefix: "[theme-prevention]" }
 *   );
 *
 *   const topN = readNumericEnv(
 *     "THEME_CANDIDATE_TOP_N",
 *     20,
 *     { min: 1, kind: "int", logPrefix: "[theme-candidate-service]" }
 *   );
 */

interface EnvNumericOptions {
  /** Inclusive lower bound. Defaults to -Infinity. */
  min?: number;
  /** Inclusive upper bound. Defaults to +Infinity. */
  max?: number;
  /** "int" parses with parseInt(_, 10); "float" parses with parseFloat. Defaults to "float". */
  kind?: "int" | "float";
  /** Log prefix used in the warning when the env var fails validation. */
  logPrefix: string;
}

export function readNumericEnv(
  varName: string,
  fallback: number,
  options: EnvNumericOptions
): number {
  const raw = process.env[varName];
  if (!raw) return fallback;

  const parsed =
    options.kind === "int" ? parseInt(raw, 10) : parseFloat(raw);
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (isNaN(parsed) || parsed < min || parsed > max) {
    console.warn(
      `${options.logPrefix} ${varName}="${raw}" is invalid (must be ${describeKind(options.kind)} ${describeRange(min, max)}) — falling back to default ${fallback}`
    );
    return fallback;
  }
  return parsed;
}

function describeKind(kind: EnvNumericOptions["kind"]): string {
  return kind === "int" ? "integer" : "number";
}

function describeRange(min: number, max: number): string {
  if (min === -Infinity && max === Infinity) return "(any)";
  if (min === -Infinity) return `≤ ${max}`;
  if (max === Infinity) return `≥ ${min}`;
  return `${min}..${max}`;
}
