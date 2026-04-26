// ---------------------------------------------------------------------------
// Database Query — Base Query Builders
// ---------------------------------------------------------------------------
// Standard team/date/clientIds filter chains for `sessions` and `clients`
// table queries. Lifted out of the monolith so domain handlers don't reach
// into Supabase query primitives directly.
// ---------------------------------------------------------------------------

import { scopeByTeam } from "@/lib/repositories/supabase/scope-by-team";

import type { QueryFilters } from "../types";

/**
 * Applies team scoping, soft-delete filtering, optional date range, and
 * optional client ID filtering to a query on the `sessions` table.
 * Most handlers share this exact pattern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are loosely typed
export function baseSessionQuery(query: any, filters: QueryFilters): any {
  let q = query.is("deleted_at", null);
  q = scopeByTeam(q, filters.teamId);
  if (filters.dateFrom) {
    q = q.gte("session_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    q = q.lte("session_date", filters.dateTo);
  }
  if (filters.clientIds && filters.clientIds.length > 0) {
    q = q.in("client_id", filters.clientIds);
  }
  return q;
}

/**
 * Applies team scoping and soft-delete filtering to a query on the `clients`
 * table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are loosely typed
export function baseClientQuery(query: any, filters: QueryFilters): any {
  let q = query.is("deleted_at", null);
  q = scopeByTeam(q, filters.teamId);
  return q;
}
