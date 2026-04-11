// ---------------------------------------------------------------------------
// Database Query Service (PRD-020 Part 2)
// ---------------------------------------------------------------------------
// Maps action strings to parameterized Supabase queries. The LLM never sees or
// generates SQL — it selects an action and provides filter values, and this
// service executes the corresponding safe query.
//
// Framework-agnostic: no HTTP or Next.js imports.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { scopeByTeam } from "@/lib/repositories/supabase/scope-by-team";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[database-query-service]";

export type QueryAction =
  | "count_clients"
  | "count_sessions"
  | "sessions_per_client"
  | "sentiment_distribution"
  | "urgency_distribution"
  | "recent_sessions"
  | "client_list";

export interface QueryFilters {
  teamId: string | null;
  dateFrom?: string;
  dateTo?: string;
  clientName?: string;
}

export interface DatabaseQueryResult {
  action: QueryAction;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleCountClients(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  let query = supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  query = scopeByTeam(query, filters.teamId);

  const { count, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} count_clients error:`, error);
    throw new Error("Failed to count clients");
  }

  return { count: count ?? 0 };
}

async function handleCountSessions(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  let query = supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  query = scopeByTeam(query, filters.teamId);

  if (filters.dateFrom) {
    query = query.gte("session_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("session_date", filters.dateTo);
  }

  const { count, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} count_sessions error:`, error);
    throw new Error("Failed to count sessions");
  }

  return { count: count ?? 0 };
}

async function handleSessionsPerClient(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // Fetch sessions with client names, then group in JS
  let query = supabase
    .from("sessions")
    .select("client_id, clients(name)")
    .is("deleted_at", null);

  query = scopeByTeam(query, filters.teamId);

  if (filters.dateFrom) {
    query = query.gte("session_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("session_date", filters.dateTo);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} sessions_per_client error:`, error);
    throw new Error("Failed to fetch sessions per client");
  }

  // Group by client name
  const countMap = new Map<string, number>();
  for (const row of data ?? []) {
    const clientData = row.clients as unknown as { name: string } | null;
    const name = clientData?.name ?? "Unknown";
    countMap.set(name, (countMap.get(name) ?? 0) + 1);
  }

  const clients = Array.from(countMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { clients };
}

async function handleSentimentDistribution(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // Fetch structured_json->sentiment for all sessions, aggregate in JS.
  // Supabase JS client doesn't support jsonb grouping natively.
  let query = supabase
    .from("sessions")
    .select("structured_json")
    .is("deleted_at", null)
    .not("structured_json", "is", null);

  query = scopeByTeam(query, filters.teamId);

  if (filters.dateFrom) {
    query = query.gte("session_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("session_date", filters.dateTo);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} sentiment_distribution error:`, error);
    throw new Error("Failed to fetch sentiment distribution");
  }

  const distribution: Record<string, number> = {
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
  };

  for (const row of data ?? []) {
    const json = row.structured_json as Record<string, unknown> | null;
    const sentiment = json?.sentiment as string | undefined;
    if (sentiment && sentiment in distribution) {
      distribution[sentiment]++;
    }
  }

  return distribution;
}

async function handleUrgencyDistribution(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  let query = supabase
    .from("sessions")
    .select("structured_json")
    .is("deleted_at", null)
    .not("structured_json", "is", null);

  query = scopeByTeam(query, filters.teamId);

  if (filters.dateFrom) {
    query = query.gte("session_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("session_date", filters.dateTo);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} urgency_distribution error:`, error);
    throw new Error("Failed to fetch urgency distribution");
  }

  const distribution: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const row of data ?? []) {
    const json = row.structured_json as Record<string, unknown> | null;
    const urgency = json?.urgency as string | undefined;
    if (urgency && urgency in distribution) {
      distribution[urgency]++;
    }
  }

  return distribution;
}

async function handleRecentSessions(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  let query = supabase
    .from("sessions")
    .select("id, session_date, structured_json, clients(name)")
    .is("deleted_at", null)
    .order("session_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  query = scopeByTeam(query, filters.teamId);

  if (filters.clientName) {
    // Filter by client name via the clients join
    query = query.eq("clients.name", filters.clientName);
  }
  if (filters.dateFrom) {
    query = query.gte("session_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("session_date", filters.dateTo);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} recent_sessions error:`, error);
    throw new Error("Failed to fetch recent sessions");
  }

  const sessions = (data ?? []).map((row) => {
    const clientData = row.clients as unknown as { name: string } | null;
    const json = row.structured_json as Record<string, unknown> | null;
    return {
      clientName: clientData?.name ?? "Unknown",
      sessionDate: row.session_date,
      sentiment: (json?.sentiment as string) ?? "unknown",
    };
  });

  return { sessions };
}

async function handleClientList(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  let query = supabase
    .from("clients")
    .select("name")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  query = scopeByTeam(query, filters.teamId);

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} client_list error:`, error);
    throw new Error("Failed to fetch client list");
  }

  const clients = (data ?? []).map((row) => row.name as string);

  return { clients };
}

// ---------------------------------------------------------------------------
// Action map
// ---------------------------------------------------------------------------

const ACTION_MAP: Record<
  QueryAction,
  (supabase: SupabaseClient, filters: QueryFilters) => Promise<Record<string, unknown>>
> = {
  count_clients: handleCountClients,
  count_sessions: handleCountSessions,
  sessions_per_client: handleSessionsPerClient,
  sentiment_distribution: handleSentimentDistribution,
  urgency_distribution: handleUrgencyDistribution,
  recent_sessions: handleRecentSessions,
  client_list: handleClientList,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Executes a predefined database query action with the given filters.
 * The action string selects the query; the service maps it to a safe,
 * parameterized Supabase query. No raw SQL is exposed to the caller.
 *
 * @throws Error if the action is unknown or the query fails.
 */
export async function executeQuery(
  supabase: SupabaseClient,
  action: QueryAction,
  filters: QueryFilters
): Promise<DatabaseQueryResult> {
  console.log(
    `${LOG_PREFIX} executeQuery — action: ${action}, teamId: ${filters.teamId ?? "personal"}, filters: ${JSON.stringify({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      clientName: filters.clientName,
    })}`
  );

  const handler = ACTION_MAP[action];
  if (!handler) {
    console.error(`${LOG_PREFIX} unknown action: ${action}`);
    throw new Error(`Unknown query action: ${action}`);
  }

  const start = Date.now();
  const data = await handler(supabase, filters);
  const elapsed = Date.now() - start;

  console.log(
    `${LOG_PREFIX} executeQuery — action: ${action} completed in ${elapsed}ms`
  );

  return { action, data };
}
