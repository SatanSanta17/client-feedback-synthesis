"use client";

import { useMemo } from "react";

import { useDashboardFetch } from "./use-dashboard-fetch";

interface RecentlyMergedThemesData {
  themeIds: string[];
  windowDays: number;
}

/**
 * Returns the canonical-theme-id set whose themes have been the destination
 * of a merge within the configured window (PRD-026 Part 4 P4.R2). Wraps
 * `useDashboardFetch` + Set construction so each theme widget consumes a
 * single membership-test surface (`Set.has`) without re-implementing the
 * fetch lifecycle.
 *
 * Three callers today: top-themes, theme-trends, theme-client-matrix
 * widgets. Each call still results in one `/api/dashboard?action=...`
 * request — that's a property of `useDashboardFetch`, not this hook —
 * but the duplicated wiring + memoisation now lives in one place.
 */
export function useRecentlyMergedThemes(): Set<string> {
  const { data } = useDashboardFetch<RecentlyMergedThemesData>({
    action: "recently_merged_themes",
  });

  return useMemo(
    () => new Set(data?.themeIds ?? []),
    [data?.themeIds]
  );
}
