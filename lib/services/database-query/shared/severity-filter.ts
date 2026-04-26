// ---------------------------------------------------------------------------
// Database Query — Severity Filter
// ---------------------------------------------------------------------------
// One cohesive module owning severity filtering. Severity is per-chunk inside
// `structured_json` (painPoints / requirements / aspirations / blockers /
// custom.signals) and is not joinable via SQL — every code path must scan
// the chunk arrays.
//
// Three named exports cover three call patterns:
//   1. sessionHasSeverity         — sync predicate (one row at a time)
//   2. filterRowsBySeverity       — sync filter (post-filter on row arrays)
//   3. resolveSessionIdsBySeverity — async pre-filter (returns the matching
//                                    set of session IDs for downstream joins)
//
// Replaces the pre-cleanup helpers sessionHasSignalWithSeverity,
// applySeverityRowFilter, and fetchSessionIdsMatchingSeverity (PRD-023 P5.R2).
// Bodies are moved verbatim — no semantic change.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { LOG_PREFIX } from "../action-metadata";
import type { QueryFilters } from "../types";
import { baseSessionQuery } from "./base-query-builder";

/**
 * Returns true if the session's `structured_json` contains at least one
 * signal chunk whose `severity` matches the requested value. Severity is a
 * per-chunk field (not session-level), so this scans the chunk arrays:
 * painPoints, requirements, aspirations, blockers, and custom.signals.
 */
export function sessionHasSeverity(
  json: Record<string, unknown> | null,
  severity: string
): boolean {
  if (!json) return false;

  const arrayKeys = [
    "painPoints",
    "requirements",
    "aspirations",
    "blockers",
  ] as const;
  for (const key of arrayKeys) {
    const arr = json[key] as Array<{ severity?: string }> | undefined;
    if (arr?.some((s) => s.severity === severity)) return true;
  }

  const custom = json.custom as
    | Array<{ signals?: Array<{ severity?: string }> }>
    | undefined;
  if (
    custom?.some((c) => c.signals?.some((s) => s.severity === severity))
  ) {
    return true;
  }

  return false;
}

/**
 * Inline post-filter for handler rows that already include `structured_json`.
 * Returns the input untouched when no severity filter is set.
 */
export function filterRowsBySeverity<T extends { structured_json?: unknown }>(
  rows: T[],
  severity: string | undefined
): T[] {
  if (!severity) return rows;
  return rows.filter((r) =>
    sessionHasSeverity(
      (r.structured_json as Record<string, unknown> | null) ?? null,
      severity
    )
  );
}

/**
 * Pre-filter helper for handlers that don't fetch `structured_json` directly
 * (e.g. count handlers, theme join handlers). Returns the set of session IDs
 * within team/date scope that have at least one signal chunk matching the
 * requested severity. Returns null when no severity filter is set so callers
 * can skip the extra query and the in-clause cleanly.
 */
export async function resolveSessionIdsBySeverity(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Set<string> | null> {
  if (!filters.severity) return null;

  const query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("id, structured_json")
      .not("structured_json", "is", null),
    filters
  );

  const { data, error } = await query;
  if (error) {
    console.error(
      `${LOG_PREFIX} fetchSessionIdsMatchingSeverity error:`,
      error
    );
    throw new Error("Failed to filter sessions by severity");
  }

  const matching = new Set<string>();
  for (const row of (data ?? []) as Array<{
    id: string;
    structured_json: Record<string, unknown> | null;
  }>) {
    if (sessionHasSeverity(row.structured_json, filters.severity)) {
      matching.add(row.id);
    }
  }
  return matching;
}
