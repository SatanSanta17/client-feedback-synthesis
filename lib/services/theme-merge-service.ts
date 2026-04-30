/**
 * Theme Merge Service (PRD-026 Part 3)
 *
 * Owns two operations against the merge surface:
 *   - mergeCandidatePair: validate the candidate + canonical choice, then
 *     execute the atomic merge_themes RPC; returns MergeResult.
 *   - listRecentMerges:   read the workspace's audit log for the
 *     "Recent merges" section.
 *
 * Strict separation from Part 4: this service does NOT emit notifications.
 * Part 4 will wire `notificationService.emit({ eventType: "theme.merged",
 * payload: { ...result, actorId, actorName }, teamId, broadcast: true })`
 * into a fire-and-forget chain after `mergeCandidatePair` resolves; no
 * service-shape change required.
 */

import type {
  ThemeCandidateRepository,
} from "@/lib/repositories/theme-candidate-repository";
import type { ThemeMergeRepository } from "@/lib/repositories/theme-merge-repository";
import type { MergeResult, ThemeMerge } from "@/lib/types/theme-merge";
import {
  matchesWorkspace,
  type WorkspaceCtx,
} from "@/lib/services/workspace-context";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RECENT_TOP_N = 10;
const MAX_RECENT_TOP_N = 100;

const LOG = "[theme-merge-service]";

// ---------------------------------------------------------------------------
// Public types + errors
// ---------------------------------------------------------------------------

/** Surfaced to the API layer — translated to 404. */
export class CandidateNotFoundForMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateNotFoundForMergeError";
  }
}

/** Surfaced to the API layer — translated to 400. */
export class InvalidCanonicalChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCanonicalChoiceError";
  }
}

export interface ListRecentMergesResult {
  items: ThemeMerge[];
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the merge transaction for one candidate pair.
 *
 *   1. Look up the candidate (defense in depth — the API gated already).
 *   2. Verify the candidate belongs to the requesting workspace.
 *   3. Validate that `canonicalThemeId` is one of the candidate's two ids.
 *   4. Derive `archivedThemeId` as the other side.
 *   5. Call `mergeRepo.executeMerge(...)` — the RPC is the atomic unit.
 *
 * The candidate row is removed by the RPC's cleanup step (TRD Decision 25),
 * not by an explicit second call. Same for the dismissals row if any. So
 * `mergeCandidatePair` returns and the surface is consistent in one round.
 */
export async function mergeCandidatePair(input: {
  candidateId: string;
  canonicalThemeId: string;
  workspace: WorkspaceCtx;
  actorId: string;
  candidateRepo: ThemeCandidateRepository;
  mergeRepo: ThemeMergeRepository;
}): Promise<MergeResult> {
  const {
    candidateId,
    canonicalThemeId,
    workspace,
    actorId,
    candidateRepo,
    mergeRepo,
  } = input;

  console.log(
    `${LOG} mergeCandidatePair — candidate: ${candidateId} | canonical: ${canonicalThemeId} | teamId: ${workspace.teamId} | actor: ${actorId}`
  );

  const candidate = await candidateRepo.getById(candidateId);
  if (!candidate) {
    throw new CandidateNotFoundForMergeError(
      `Candidate ${candidateId} not found`
    );
  }

  if (!matchesWorkspace(candidate, workspace)) {
    // Treat as not-found from the caller's perspective — the candidate
    // exists but in a different workspace; surfacing that distinction
    // would leak ownership info. Same convention as dismissCandidate.
    throw new CandidateNotFoundForMergeError(
      `Candidate ${candidateId} not found in this workspace`
    );
  }

  if (
    canonicalThemeId !== candidate.themeAId &&
    canonicalThemeId !== candidate.themeBId
  ) {
    throw new InvalidCanonicalChoiceError(
      `canonicalThemeId must be one of the candidate's two theme ids`
    );
  }

  const archivedThemeId =
    canonicalThemeId === candidate.themeAId
      ? candidate.themeBId
      : candidate.themeAId;

  const result = await mergeRepo.executeMerge({
    archivedThemeId,
    canonicalThemeId,
    actorId,
  });

  console.log(
    `${LOG} mergeCandidatePair — done | audit: ${result.auditId} | reassigned: ${result.signalAssignmentsRepointed}`
  );

  return result;
}

/**
 * Read the workspace's most recent merges, ordered by mergedAt DESC.
 * Pagination uses the same fetch-`limit + 1` pattern as `listCandidates` so
 * `hasMore` is computed without a second `count(*)` query.
 */
export async function listRecentMerges(input: {
  workspace: WorkspaceCtx;
  mergeRepo: ThemeMergeRepository;
  limit?: number;
  offset?: number;
}): Promise<ListRecentMergesResult> {
  const { workspace, mergeRepo } = input;

  const requestedLimit = input.limit ?? DEFAULT_RECENT_TOP_N;
  const limit = Math.max(1, Math.min(MAX_RECENT_TOP_N, requestedLimit));
  const offset = Math.max(0, input.offset ?? 0);

  console.log(
    `${LOG} listRecentMerges — teamId: ${workspace.teamId} | userId: ${workspace.userId} | limit: ${limit} | offset: ${offset}`
  );

  const rows = await mergeRepo.listByWorkspace(
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
