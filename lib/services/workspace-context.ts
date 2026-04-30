// ---------------------------------------------------------------------------
// Workspace Context (shared service helper)
// ---------------------------------------------------------------------------
//
// `WorkspaceCtx` is the workspace-identifier shape services receive from API
// routes (built from `requireWorkspaceAdmin` / `getActiveTeamId` + auth user).
// `matchesWorkspace` is the membership-check used by services that fetch a
// row by id and want to defensively confirm it belongs to the requesting
// workspace before acting on it (defense in depth — the API route already
// gated, but a misrouted call could still land in the service).
//
// First introduced for PRD-026 Part 2 (extracted in Part 3 once a second
// consumer needed it).
// ---------------------------------------------------------------------------

export interface WorkspaceCtx {
  teamId: string | null;
  userId: string;
}

/**
 * Returns true when `row` is owned by `workspace`.
 *
 * Team workspaces match on `team_id`; personal workspaces require both
 * `team_id IS NULL` AND ownership by the same user.
 */
export function matchesWorkspace(
  row: { teamId: string | null; initiatedBy: string },
  workspace: WorkspaceCtx
): boolean {
  if (workspace.teamId !== null) {
    return row.teamId === workspace.teamId;
  }
  return row.teamId === null && row.initiatedBy === workspace.userId;
}
