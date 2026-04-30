// ---------------------------------------------------------------------------
// Theme Merge Types (PRD-026 Part 3)
// ---------------------------------------------------------------------------
//
// Domain types for the admin-confirmed theme merge surface.
//
// `ThemeMerge` is the audit-row shape (read by the "Recent merges" list).
// `MergeResult` is what the service returns after a successful merge — a
// strict superset of `themeMergedPayloadSchema` from
// `lib/notifications/events.ts` minus `actorName` (Part 4 will resolve
// the actor name from `profiles.email` when emitting the notification).
// ---------------------------------------------------------------------------

export interface ThemeMerge {
  id: string;
  teamId: string | null;
  initiatedBy: string;
  archivedThemeId: string;
  canonicalThemeId: string;
  archivedThemeName: string;
  canonicalThemeName: string;
  actorId: string;
  reassignedCount: number;
  distinctSessions: number;
  distinctClients: number;
  mergedAt: string;
}

export interface MergeResult {
  auditId: string;
  archivedThemeId: string;
  archivedThemeName: string;
  canonicalThemeId: string;
  canonicalThemeName: string;
  /**
   * Renamed from RPC's `reassigned_count` for the camelCase domain shape;
   * same semantics as `themeMergedPayloadSchema.signalAssignmentsRepointed`.
   * Lets Part 4 hand `MergeResult` straight into the notification payload
   * (plus the resolved `actorName`) without a second adapter step.
   */
  signalAssignmentsRepointed: number;
  distinctSessions: number;
  distinctClients: number;
  teamId: string | null;
}
