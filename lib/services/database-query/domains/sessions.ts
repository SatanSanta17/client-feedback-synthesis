// ---------------------------------------------------------------------------
// Database Query — Sessions Domain
// ---------------------------------------------------------------------------
// Per-session listings, the time-series RPC, and the per-client health grid.
// `client_health_grid` lives here (not in counts) because it operates on
// session rows and applies session-level severity/urgency post-filters.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { LOG_PREFIX } from "../action-metadata";
import { baseSessionQuery } from "../shared/base-query-builder";
import { extractClientName } from "../shared/row-helpers";
import {
  filterRowsBySeverity,
  sessionHasSeverity,
} from "../shared/severity-filter";
import type { QueryFilters } from "../types";

export async function handleRecentSessions(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  let query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("id, session_date, structured_json, clients(name)")
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20),
    filters
  );

  if (filters.clientName) {
    query = query.eq("clients.name", filters.clientName);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} recent_sessions error:`, error);
    throw new Error("Failed to fetch recent sessions");
  }

  const rows = filterRowsBySeverity(data ?? [], filters.severity);

  const sessions = rows.map((row: Record<string, unknown>) => {
    const json = row.structured_json as Record<string, unknown> | null;
    return {
      clientName: extractClientName(row),
      sessionDate: row.session_date,
      sentiment: (json?.sentiment as string) ?? "unknown",
    };
  });

  return { sessions };
}

export async function handleSessionsOverTime(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("sessions_over_time", {
    p_team_id: filters.teamId,
    p_date_from: filters.dateFrom ?? null,
    p_date_to: filters.dateTo ?? null,
    p_granularity: filters.granularity ?? "week",
  });

  if (error) {
    console.error(`${LOG_PREFIX} sessions_over_time error:`, error);
    throw new Error("Failed to fetch sessions over time");
  }

  return { buckets: data ?? [] };
}

export async function handleClientHealthGrid(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("client_id, session_date, structured_json, clients(name)")
      .not("structured_json", "is", null)
      .order("session_date", { ascending: false }),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} client_health_grid error:`, error);
    throw new Error("Failed to fetch client health grid");
  }

  // Keep only the most recent session per client (DISTINCT ON simulation)
  const latestByClient = new Map<string, Record<string, unknown>>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const clientId = row.client_id as string;
    if (!latestByClient.has(clientId)) {
      latestByClient.set(clientId, row);
    }
  }

  const clients = Array.from(latestByClient.values())
    .map((row) => {
      const json = row.structured_json as Record<string, unknown> | null;
      const sentiment = (json?.sentiment as string) ?? "unknown";
      const urgency = (json?.urgency as string) ?? "unknown";

      // Apply severity/urgency post-filters if provided
      if (filters.urgency && urgency !== filters.urgency) return null;
      if (
        filters.severity &&
        !sessionHasSeverity(
          row.structured_json as Record<string, unknown> | null,
          filters.severity
        )
      ) {
        return null;
      }

      return {
        clientId: row.client_id,
        clientName: extractClientName(row),
        sentiment,
        urgency,
        sessionDate: row.session_date,
      };
    })
    .filter(Boolean);

  return { clients };
}
