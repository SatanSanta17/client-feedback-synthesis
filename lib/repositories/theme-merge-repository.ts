// ---------------------------------------------------------------------------
// Theme Merge Repository Interface (PRD-026 Part 3)
// ---------------------------------------------------------------------------
//
// Two responsibilities, one interface:
//   - executeMerge: thin wrapper over the `merge_themes` RPC. The RPC owns
//                   every workspace-scope and archive invariant; the adapter
//                   translates Postgres SQLSTATE codes into typed errors so
//                   the API layer can map them cleanly to HTTP statuses.
//   - listByWorkspace: read recent merges for the "Recent merges" surface
//                       (PRD-026 P3.R7), ordered by mergedAt DESC.
// ---------------------------------------------------------------------------

import type { MergeResult, ThemeMerge } from "@/lib/types/theme-merge";

export interface ListMergesOptions {
  limit: number;
  offset: number;
}

export interface ThemeMergeRepository {
  /**
   * Calls `merge_themes` RPC (atomic re-point + archive + cleanup + audit).
   * Errors raised inside the function carry SQLSTATE codes that the adapter
   * translates into the typed error classes defined below.
   */
  executeMerge(input: {
    archivedThemeId: string;
    canonicalThemeId: string;
    actorId: string;
  }): Promise<MergeResult>;

  /** Read recent merges for a workspace, ordered by mergedAt DESC. */
  listByWorkspace(
    teamId: string | null,
    userId: string,
    options: ListMergesOptions
  ): Promise<ThemeMerge[]>;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------
//
// SQLSTATE → error class mapping mirrors the codes raised inside `merge_themes`:
//   '22023' (invalid parameter) — same theme / archived already / cross-workspace
//   'P0002' (no data found)     — theme id not present in `themes`
// Any other DB error surfaces as a generic MergeRepoError so the route can
// fall through to a 500.

export class MergeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeValidationError";
  }
}

export class MergeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeNotFoundError";
  }
}

export class MergeRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeRepoError";
  }
}
