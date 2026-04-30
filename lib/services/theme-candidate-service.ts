/**
 * Theme Candidate Service (PRD-026 Part 2)
 *
 * Owns three operations against the persisted candidate set:
 *   - refreshCandidates: rebuild for a workspace (transactional replace).
 *   - listCandidates:    read top-N by combined_score.
 *   - dismissCandidate:  record an admin's "not a duplicate" judgment.
 *
 * Scoring math (Decision 12) and shared-keyword extraction (Decision 19)
 * live here as pure helpers so weight changes are a single-file edit + redeploy.
 */

import { type SupabaseClient } from "@supabase/supabase-js";

import {
  pairKey,
  type ThemeCandidateInsert,
  type ThemeCandidatePairsRepository,
  type ThemeCandidateRepository,
  type ThemeDismissalRepository,
} from "@/lib/repositories";
import type { ThemeRepository } from "@/lib/repositories/theme-repository";
import type { Theme } from "@/lib/types/theme";
import type {
  CandidatePair,
  ThemeCandidateWithThemes,
  ThemeSideStats,
} from "@/lib/types/theme-candidate";
import {
  matchesWorkspace,
  type WorkspaceCtx,
} from "@/lib/services/workspace-context";

export type { WorkspaceCtx } from "@/lib/services/workspace-context";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Decision 13 — wider net than P1's prevention threshold. Env-tunable. */
const DEFAULT_CANDIDATE_THRESHOLD = 0.8;

/** Decision 14 — default page size for the admin surface. Env-tunable. */
const DEFAULT_TOP_N = 20;

/** Hard ceiling on per-request page size — prevents an abusive `limit=10000`. */
const MAX_TOP_N = 100;

/**
 * Decision 12 — composite-score weights.
 *   combined = W_SIM · sim + W_VOL · vol + W_REC · rec   (sums to 1.0)
 */
const W_SIM = 0.5;
const W_VOL = 0.3;
const W_REC = 0.2;

/** Volume normalisation cap — a pair touching VOLUME_NORM+ signals saturates. */
const VOLUME_NORM = 200;

/** Recency half-life — `1.0` today, `~0.37` at 30d, `~0.05` at 90d. */
const RECENCY_HALF_LIFE_DAYS = 30;

/** Decision 19 — cap shared-keywords output for legibility. */
const KEYWORD_CAP = 3;

/**
 * Built-in stop words for the shared-keywords hint. Intentionally minimal —
 * the goal is to drop obvious noise like "the"/"of", not to do full NLP.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "for", "in", "on",
  "with", "is", "are", "this", "that", "these", "those", "it", "its",
  "by", "as", "at", "be", "from",
]);

const LOG = "[theme-candidate-service]";

// ---------------------------------------------------------------------------
// Public types + errors
// ---------------------------------------------------------------------------

export interface RefreshResult {
  workspace: WorkspaceCtx;
  candidatesGenerated: number;
  pairsAboveThreshold: number;
  dismissedFiltered: number;
  refreshBatchId: string;
  elapsedMs: number;
}

export interface ListCandidatesResult {
  items: ThemeCandidateWithThemes[];
  hasMore: boolean;
}

/** Surfaced to the API layer — translated to 404. */
export class CandidateNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateNotFoundError";
  }
}

/** Surfaced to the API layer — translated to 403. */
export class CandidateAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateAccessError";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rebuilds the persisted candidate set for one workspace.
 *
 * Flow (Decision 17 — transactional replace):
 *   1. Find all pairs above the candidate-similarity threshold (RPC).
 *   2. Filter out dismissed pairs (in-memory join against the workspace's
 *      dismissals set).
 *   3. Fetch per-theme stats (one RPC) and the workspace's active themes
 *      (for keyword extraction).
 *   4. Score every surviving pair, build inserts.
 *   5. Delete the workspace's existing candidate rows + bulk-insert the new
 *      set under a single refresh_batch_id.
 */
export async function refreshCandidates(input: {
  workspace: WorkspaceCtx;
  serviceClient: SupabaseClient;
  candidateRepo: ThemeCandidateRepository;
  pairsRepo: ThemeCandidatePairsRepository;
  dismissalRepo: ThemeDismissalRepository;
  themeRepo: ThemeRepository;
}): Promise<RefreshResult> {
  const {
    workspace,
    serviceClient,
    candidateRepo,
    pairsRepo,
    dismissalRepo,
    themeRepo,
  } = input;

  const startedAt = Date.now();
  const refreshBatchId = crypto.randomUUID();

  console.log(
    `${LOG} refreshCandidates — start | teamId: ${workspace.teamId} | userId: ${workspace.userId} | batch: ${refreshBatchId}`
  );

  try {
    const threshold = readCandidateThresholdFromEnv();

    // 1. Pairs above threshold
    const allPairs = await pairsRepo.findPairs(
      workspace.teamId,
      workspace.userId,
      threshold
    );

    // 2. Dismissed-pairs filter
    const dismissedKeys = await dismissalRepo.listPairKeysByWorkspace(
      workspace.teamId,
      workspace.userId
    );
    const livePairs = allPairs.filter(
      (p) => !dismissedKeys.has(pairKey(p.themeAId, p.themeBId))
    );
    const dismissedFiltered = allPairs.length - livePairs.length;

    console.log(
      `${LOG} refreshCandidates — threshold: ${threshold} | aboveThreshold: ${allPairs.length} | dismissedFiltered: ${dismissedFiltered} | live: ${livePairs.length}`
    );

    // 3. Stats + theme metadata. Even when livePairs is empty we still want
    //    to clear stale candidates — the empty-bulkCreate is a no-op below.
    let inserts: ThemeCandidateInsert[] = [];
    if (livePairs.length > 0) {
      const themeIds = collectUniqueThemeIds(livePairs);
      const [statsByThemeId, activeThemes] = await Promise.all([
        fetchThemeStats(serviceClient, themeIds),
        themeRepo.getActiveByWorkspace(workspace.teamId, workspace.userId),
      ]);
      const themeById = new Map<string, Theme>(
        activeThemes.map((t) => [t.id, t])
      );

      // 4. Build inserts
      inserts = livePairs.map((pair) =>
        buildCandidateInsert({
          pair,
          workspace,
          themeById,
          statsByThemeId,
          refreshBatchId,
        })
      );
    }

    // 5. Transactional replace — delete first, then bulk insert.
    //    Two sequential calls (Supabase JS does not expose multi-statement
    //    transactions); the brief gap is acceptable for an admin surface
    //    and is bounded by the bulk-insert duration.
    await candidateRepo.deleteByWorkspace(workspace.teamId, workspace.userId);
    if (inserts.length > 0) {
      await candidateRepo.bulkCreate(inserts);
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `${LOG} refreshCandidates — done | candidates: ${inserts.length} | elapsedMs: ${elapsedMs}`
    );

    return {
      workspace,
      candidatesGenerated: inserts.length,
      pairsAboveThreshold: allPairs.length,
      dismissedFiltered,
      refreshBatchId,
      elapsedMs,
    };
  } catch (err) {
    console.error(
      `${LOG} refreshCandidates — failed for teamId: ${workspace.teamId}, userId: ${workspace.userId}:`,
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
    throw err;
  }
}

/**
 * Read top-N candidates ordered by combined_score, joined with theme metadata.
 *
 * Pagination uses a fetch-`limit + 1` pattern: if the repository returns more
 * than `limit` rows, we know there is at least one more page and trim the
 * extra row before returning. This avoids a second `count(*)` query and
 * matches the notification-repository pattern used elsewhere.
 */
export async function listCandidates(input: {
  workspace: WorkspaceCtx;
  candidateRepo: ThemeCandidateRepository;
  limit?: number;
  offset?: number;
}): Promise<ListCandidatesResult> {
  const { workspace, candidateRepo } = input;

  const requestedLimit = input.limit ?? readTopNFromEnv();
  const limit = Math.max(1, Math.min(MAX_TOP_N, requestedLimit));
  const offset = Math.max(0, input.offset ?? 0);

  console.log(
    `${LOG} listCandidates — teamId: ${workspace.teamId} | userId: ${workspace.userId} | limit: ${limit} | offset: ${offset}`
  );

  const rows = await candidateRepo.listByWorkspace(
    workspace.teamId,
    workspace.userId,
    { limit: limit + 1, offset }
  );

  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    hasMore,
  };
}

/**
 * Records the admin's "not a duplicate" judgment + removes the candidate row.
 * Future refreshes filter the dismissal in step 2 of refreshCandidates so the
 * pair never resurfaces (P2.R5).
 */
export async function dismissCandidate(input: {
  candidateId: string;
  workspace: WorkspaceCtx;
  actingUserId: string;
  candidateRepo: ThemeCandidateRepository;
  dismissalRepo: ThemeDismissalRepository;
}): Promise<void> {
  const {
    candidateId,
    workspace,
    actingUserId,
    candidateRepo,
    dismissalRepo,
  } = input;

  console.log(
    `${LOG} dismissCandidate — candidateId: ${candidateId} | teamId: ${workspace.teamId} | actor: ${actingUserId}`
  );

  const candidate = await candidateRepo.getById(candidateId);
  if (!candidate) {
    throw new CandidateNotFoundError(`Candidate ${candidateId} not found`);
  }

  // Defense-in-depth (Decision 21). The API layer's role check is the primary
  // gate; this catches a misrouted call or a candidate-id from a different
  // workspace passed to this workspace's endpoint.
  if (!matchesWorkspace(candidate, workspace)) {
    throw new CandidateAccessError(
      `Candidate ${candidateId} does not belong to the requested workspace`
    );
  }

  await dismissalRepo.create({
    team_id: candidate.teamId,
    initiated_by: candidate.initiatedBy,
    theme_a_id: candidate.themeAId,
    theme_b_id: candidate.themeBId,
    dismissed_by: actingUserId,
  });

  await candidateRepo.deleteById(candidateId);

  console.log(`${LOG} dismissCandidate — done | candidateId: ${candidateId}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildCandidateInsert(args: {
  pair: CandidatePair;
  workspace: WorkspaceCtx;
  themeById: Map<string, Theme>;
  statsByThemeId: Map<string, ThemeSideStats>;
  refreshBatchId: string;
}): ThemeCandidateInsert {
  const { pair, workspace, themeById, statsByThemeId, refreshBatchId } = args;

  const themeA = themeById.get(pair.themeAId);
  const themeB = themeById.get(pair.themeBId);
  if (!themeA || !themeB) {
    // Active-theme set drifted between the pair RPC and the theme fetch.
    // Surfacing this stops a refresh that would otherwise produce an
    // inconsistent candidate row.
    throw new Error(
      `${LOG} pair references missing active theme: ${pair.themeAId} or ${pair.themeBId}`
    );
  }

  const statsA = statsByThemeId.get(pair.themeAId) ?? emptyStats();
  const statsB = statsByThemeId.get(pair.themeBId) ?? emptyStats();
  const totalAssignments = statsA.assignmentCount + statsB.assignmentCount;
  const mostRecent = pickMostRecent(statsA.lastAssignedAt, statsB.lastAssignedAt);

  const sim = pair.similarity;
  const vol = volumeScore(totalAssignments);
  const rec = recencyScore(mostRecent);
  const combined = combinedScore(sim, vol, rec);

  return {
    team_id: workspace.teamId,
    initiated_by: workspace.userId,
    theme_a_id: pair.themeAId,
    theme_b_id: pair.themeBId,
    similarity_score: sim,
    volume_score: vol,
    recency_score: rec,
    combined_score: combined,
    theme_a_assignment_count: statsA.assignmentCount,
    theme_a_distinct_sessions: statsA.distinctSessions,
    theme_a_distinct_clients: statsA.distinctClients,
    theme_a_last_assigned_at: statsA.lastAssignedAt,
    theme_b_assignment_count: statsB.assignmentCount,
    theme_b_distinct_sessions: statsB.distinctSessions,
    theme_b_distinct_clients: statsB.distinctClients,
    theme_b_last_assigned_at: statsB.lastAssignedAt,
    shared_keywords: extractSharedKeywords(themeA, themeB),
    refresh_batch_id: refreshBatchId,
  };
}

function combinedScore(sim: number, vol: number, rec: number): number {
  return W_SIM * sim + W_VOL * vol + W_REC * rec;
}

function volumeScore(totalAssignments: number): number {
  if (totalAssignments <= 0) return 0;
  const score =
    Math.log10(totalAssignments + 1) / Math.log10(VOLUME_NORM + 1);
  return Math.max(0, Math.min(1, score));
}

function recencyScore(lastAssignedAt: string | null): number {
  if (!lastAssignedAt) return 0;
  const ts = new Date(lastAssignedAt).getTime();
  if (isNaN(ts)) return 0;
  const days = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
  return Math.exp(-days / RECENCY_HALF_LIFE_DAYS);
}

function pickMostRecent(
  a: string | null,
  b: string | null
): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b; // ISO-8601 strings sort lexically
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  );
}

function extractSharedKeywords(
  themeA: { name: string; description: string | null },
  themeB: { name: string; description: string | null }
): string[] {
  const tokensA = tokenize(`${themeA.name} ${themeA.description ?? ""}`);
  const tokensB = tokenize(`${themeB.name} ${themeB.description ?? ""}`);

  const shared: string[] = [];
  for (const token of tokensA) {
    if (shared.length >= KEYWORD_CAP) break;
    if (tokensB.has(token)) shared.push(token);
  }
  return shared;
}

function collectUniqueThemeIds(pairs: CandidatePair[]): string[] {
  const set = new Set<string>();
  for (const p of pairs) {
    set.add(p.themeAId);
    set.add(p.themeBId);
  }
  return [...set];
}

function emptyStats(): ThemeSideStats {
  return {
    assignmentCount: 0,
    distinctSessions: 0,
    distinctClients: 0,
    lastAssignedAt: null,
  };
}

interface ThemeStatsRow {
  theme_id: string;
  assignment_count: number;
  distinct_sessions: number;
  distinct_clients: number;
  last_assigned_at: string | null;
}

async function fetchThemeStats(
  serviceClient: SupabaseClient,
  themeIds: string[]
): Promise<Map<string, ThemeSideStats>> {
  if (themeIds.length === 0) return new Map();

  const { data, error } = await serviceClient.rpc("fetch_theme_stats", {
    theme_ids: themeIds,
  });

  if (error) {
    console.error(`${LOG} fetchThemeStats — error:`, error.message);
    throw new Error(`fetch_theme_stats failed: ${error.message}`);
  }

  const rows = (data ?? []) as ThemeStatsRow[];
  const map = new Map<string, ThemeSideStats>();
  for (const row of rows) {
    map.set(row.theme_id, {
      assignmentCount: row.assignment_count,
      distinctSessions: row.distinct_sessions,
      distinctClients: row.distinct_clients,
      lastAssignedAt: row.last_assigned_at,
    });
  }
  return map;
}

function readCandidateThresholdFromEnv(): number {
  const raw = process.env.THEME_CANDIDATE_SIMILARITY_THRESHOLD;
  if (!raw) return DEFAULT_CANDIDATE_THRESHOLD;

  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    console.warn(
      `${LOG} THEME_CANDIDATE_SIMILARITY_THRESHOLD="${raw}" is invalid (must be 0..1) — falling back to default ${DEFAULT_CANDIDATE_THRESHOLD}`
    );
    return DEFAULT_CANDIDATE_THRESHOLD;
  }
  return parsed;
}

function readTopNFromEnv(): number {
  const raw = process.env.THEME_CANDIDATE_TOP_N;
  if (!raw) return DEFAULT_TOP_N;

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1) {
    console.warn(
      `${LOG} THEME_CANDIDATE_TOP_N="${raw}" is invalid (must be positive integer) — falling back to default ${DEFAULT_TOP_N}`
    );
    return DEFAULT_TOP_N;
  }
  return parsed;
}
