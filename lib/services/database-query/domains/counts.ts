// ---------------------------------------------------------------------------
// Database Query — Counts Domain
// ---------------------------------------------------------------------------
// Scalar / grouped count handlers and the client list. Each handler is a
// verbatim move from the pre-cleanup monolith — only the imports rebind to
// the shared modules under ../shared/.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { LOG_PREFIX } from "../action-metadata";
import {
  baseClientQuery,
  baseSessionQuery,
} from "../shared/base-query-builder";
import { extractClientName } from "../shared/row-helpers";
import { filterRowsBySeverity } from "../shared/severity-filter";
import type { QueryFilters } from "../types";

export async function handleCountClients(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseClientQuery(
    supabase.from("clients").select("id", { count: "exact", head: true }),
    filters
  );

  const { count, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} count_clients error:`, error);
    throw new Error("Failed to count clients");
  }

  return { count: count ?? 0 };
}

export async function handleCountSessions(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // Server-side count is fine when there's no severity filter. With severity
  // we have to fetch structured_json and post-filter (severity is per-chunk,
  // not session-level), so the count is derived from the filtered rows.
  if (filters.severity) {
    const query = baseSessionQuery(
      supabase
        .from("sessions")
        .select("structured_json")
        .not("structured_json", "is", null),
      filters
    );
    const { data, error } = await query;
    if (error) {
      console.error(`${LOG_PREFIX} count_sessions (severity path) error:`, error);
      throw new Error("Failed to count sessions");
    }
    const filtered = filterRowsBySeverity(data ?? [], filters.severity);
    return { count: filtered.length };
  }

  const query = baseSessionQuery(
    supabase.from("sessions").select("id", { count: "exact", head: true }),
    filters
  );

  const { count, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} count_sessions error:`, error);
    throw new Error("Failed to count sessions");
  }

  return { count: count ?? 0 };
}

export async function handleSessionsPerClient(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // When severity is set we need structured_json for the post-filter; the
  // wider select is harmless and keeps the code single-path.
  const selection = filters.severity
    ? "client_id, structured_json, clients(name)"
    : "client_id, clients(name)";

  let query = baseSessionQuery(
    supabase.from("sessions").select(selection),
    filters
  );
  if (filters.severity) {
    query = query.not("structured_json", "is", null);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} sessions_per_client error:`, error);
    throw new Error("Failed to fetch sessions per client");
  }

  const rows = filterRowsBySeverity(data ?? [], filters.severity);

  // Group by client name
  const countMap = new Map<string, number>();
  for (const row of rows) {
    const name = extractClientName(row);
    countMap.set(name, (countMap.get(name) ?? 0) + 1);
  }

  const clients = Array.from(countMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { clients };
}

export async function handleClientList(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseClientQuery(
    supabase.from("clients").select("id, name").order("name", { ascending: true }),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} client_list error:`, error);
    throw new Error("Failed to fetch client list");
  }

  const clients = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
  }));

  return { clients };
}
