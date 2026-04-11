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
  | "client_list"
  // Dashboard actions (PRD-021 Part 2)
  | "sessions_over_time"
  | "client_health_grid"
  | "competitive_mention_frequency";

export interface QueryFilters {
  teamId: string | null;
  dateFrom?: string;
  dateTo?: string;
  clientName?: string;
  // Dashboard filters (PRD-021 Part 2)
  clientIds?: string[];
  severity?: string;
  urgency?: string;
  granularity?: "week" | "month";
}

export interface DatabaseQueryResult {
  action: QueryAction;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared query helpers (DRY)
// ---------------------------------------------------------------------------

/**
 * Applies team scoping, soft-delete filtering, optional date range, and
 * optional client ID filtering to a query on the `sessions` table.
 * Most handlers share this exact pattern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are loosely typed
function baseSessionQuery(query: any, filters: QueryFilters): any {
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
function baseClientQuery(query: any, filters: QueryFilters): any {
  let q = query.is("deleted_at", null);
  q = scopeByTeam(q, filters.teamId);
  return q;
}

/**
 * Extracts a string field from each row's `structured_json` column and
 * aggregates into a distribution map. Used by sentiment and urgency handlers.
 */
function aggregateJsonField(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase rows are loosely typed
  rows: any[],
  field: string,
  buckets: Record<string, number>
): Record<string, number> {
  const distribution = { ...buckets };
  for (const row of rows) {
    const json = row.structured_json as Record<string, unknown> | null;
    const value = json?.[field] as string | undefined;
    if (value && value in distribution) {
      distribution[value]++;
    }
  }
  return distribution;
}

/**
 * Casts a joined client row to extract the name.
 * Supabase returns joined rows as { name: string } | null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join types are loosely typed
function extractClientName(row: any): string {
  const clientData = row.clients as { name: string } | null;
  return clientData?.name ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleCountClients(
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

async function handleCountSessions(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
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

async function handleSessionsPerClient(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseSessionQuery(
    supabase.from("sessions").select("client_id, clients(name)"),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} sessions_per_client error:`, error);
    throw new Error("Failed to fetch sessions per client");
  }

  // Group by client name
  const countMap = new Map<string, number>();
  for (const row of data ?? []) {
    const name = extractClientName(row);
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
  const query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("structured_json")
      .not("structured_json", "is", null),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} sentiment_distribution error:`, error);
    throw new Error("Failed to fetch sentiment distribution");
  }

  return aggregateJsonField(data ?? [], "sentiment", {
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
  });
}

async function handleUrgencyDistribution(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("structured_json")
      .not("structured_json", "is", null),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} urgency_distribution error:`, error);
    throw new Error("Failed to fetch urgency distribution");
  }

  return aggregateJsonField(data ?? [], "urgency", {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  });
}

async function handleRecentSessions(
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

  const sessions = (data ?? []).map((row: Record<string, unknown>) => {
    const json = row.structured_json as Record<string, unknown> | null;
    return {
      clientName: extractClientName(row),
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

// ---------------------------------------------------------------------------
// Dashboard action handlers (PRD-021 Part 2)
// ---------------------------------------------------------------------------

async function handleSessionsOverTime(
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

async function handleClientHealthGrid(
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

async function handleCompetitiveMentionFrequency(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("structured_json")
      .not("structured_json", "is", null),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} competitive_mention_frequency error:`, error);
    throw new Error("Failed to fetch competitive mentions");
  }

  const countMap = new Map<string, number>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const json = row.structured_json as Record<string, unknown> | null;
    const mentions = json?.competitiveMentions as
      | Array<{ competitor?: string }>
      | undefined;
    if (mentions) {
      for (const mention of mentions) {
        const name = mention.competitor;
        if (name) {
          countMap.set(name, (countMap.get(name) ?? 0) + 1);
        }
      }
    }
  }

  const competitors = Array.from(countMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { competitors };
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
  // Dashboard actions (PRD-021 Part 2)
  sessions_over_time: handleSessionsOverTime,
  client_health_grid: handleClientHealthGrid,
  competitive_mention_frequency: handleCompetitiveMentionFrequency,
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
      clientIds: filters.clientIds,
      severity: filters.severity,
      urgency: filters.urgency,
      granularity: filters.granularity,
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
