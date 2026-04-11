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
import { z } from "zod";

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
  | "competitive_mention_frequency"
  // Theme widget actions (PRD-021 Part 3)
  | "top_themes"
  | "theme_trends"
  | "theme_client_matrix"
  // Drill-down actions (PRD-021 Part 4)
  | "drill_down"
  | "session_detail"
  // Insight actions (PRD-021 Part 5)
  | "insights_latest"
  | "insights_history";

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
  // Theme widget filters (PRD-021 Part 3)
  confidenceMin?: number;
  // Drill-down filters (PRD-021 Part 4)
  drillDown?: string;
  sessionId?: string;
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
// Theme query helpers (PRD-021 Part 3)
// ---------------------------------------------------------------------------

/**
 * Fetches all active (non-archived) themes for a workspace and returns a
 * Map of id → name. Used by all 3 theme widget handlers.
 */
async function fetchActiveThemeMap(
  supabase: SupabaseClient,
  teamId: string | null
): Promise<Map<string, string>> {
  let query = supabase
    .from("themes")
    .select("id, name")
    .eq("is_archived", false);

  query = scopeByTeam(query, teamId);

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} fetchActiveThemeMap error:`, error);
    throw new Error("Failed to fetch active themes");
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
    map.set(row.id, row.name);
  }

  return map;
}

/**
 * Row shape returned by the signal_themes → session_embeddings → sessions
 * nested join query. Supabase returns nested objects for joins.
 */
interface SignalThemeJoinRow {
  theme_id: string;
  confidence: number | null;
  session_embeddings: {
    chunk_type: string;
    session_id: string;
    sessions: {
      session_date: string;
      client_id: string;
      deleted_at: string | null;
    };
  };
}

/**
 * Fetches signal_themes joined through session_embeddings → sessions,
 * applying team scoping, date range, client IDs, and confidence threshold.
 * Shared by all 3 theme widget handlers.
 */
async function fetchSignalThemeRows(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<SignalThemeJoinRow[]> {
  let query = supabase
    .from("signal_themes")
    .select(
      `
      theme_id,
      confidence,
      session_embeddings!inner(
        chunk_type,
        session_id,
        team_id,
        sessions!inner(
          session_date,
          client_id,
          deleted_at
        )
      )
    `
    )
    .is("session_embeddings.sessions.deleted_at", null);

  // Team scoping on session_embeddings (which carries team_id)
  if (filters.teamId) {
    query = query.eq("session_embeddings.team_id", filters.teamId);
  } else {
    query = query.is("session_embeddings.team_id", null);
  }

  // Date range filters on sessions
  if (filters.dateFrom) {
    query = query.gte(
      "session_embeddings.sessions.session_date",
      filters.dateFrom
    );
  }
  if (filters.dateTo) {
    query = query.lte(
      "session_embeddings.sessions.session_date",
      filters.dateTo
    );
  }

  // Client ID filter on sessions
  if (filters.clientIds && filters.clientIds.length > 0) {
    query = query.in(
      "session_embeddings.sessions.client_id",
      filters.clientIds
    );
  }

  // Confidence threshold on signal_themes
  if (filters.confidenceMin !== undefined) {
    query = query.gte("confidence", filters.confidenceMin);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} fetchSignalThemeRows error:`, error);
    throw new Error("Failed to fetch signal theme data");
  }

  return (data ?? []) as unknown as SignalThemeJoinRow[];
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
// Theme widget action handlers (PRD-021 Part 3)
// ---------------------------------------------------------------------------

async function handleTopThemes(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const [themeMap, rows] = await Promise.all([
    fetchActiveThemeMap(supabase, filters.teamId),
    fetchSignalThemeRows(supabase, filters),
  ]);

  // Aggregate by theme_id with chunk_type sub-counts
  const themeAgg = new Map<
    string,
    { count: number; breakdown: Record<string, number> }
  >();

  for (const row of rows) {
    const tid = row.theme_id;
    if (!themeMap.has(tid)) continue; // skip archived/deleted themes

    let agg = themeAgg.get(tid);
    if (!agg) {
      agg = { count: 0, breakdown: {} };
      themeAgg.set(tid, agg);
    }

    agg.count++;
    const chunkType = row.session_embeddings.chunk_type;
    agg.breakdown[chunkType] = (agg.breakdown[chunkType] ?? 0) + 1;
  }

  // Sort by total count descending
  const themes = Array.from(themeAgg.entries())
    .map(([themeId, { count, breakdown }]) => ({
      themeId,
      themeName: themeMap.get(themeId) ?? "Unknown",
      count,
      breakdown,
    }))
    .sort((a, b) => b.count - a.count);

  return { themes };
}

async function handleThemeTrends(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const [themeMap, rows] = await Promise.all([
    fetchActiveThemeMap(supabase, filters.teamId),
    fetchSignalThemeRows(supabase, filters),
  ]);

  const granularity = filters.granularity ?? "week";

  // Group by (bucket, theme_id) in TypeScript
  const bucketMap = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const tid = row.theme_id;
    if (!themeMap.has(tid)) continue;

    const sessionDate = new Date(row.session_embeddings.sessions.session_date);
    const bucket = dateTrunc(granularity, sessionDate);

    let counts = bucketMap.get(bucket);
    if (!counts) {
      counts = {};
      bucketMap.set(bucket, counts);
    }
    counts[tid] = (counts[tid] ?? 0) + 1;
  }

  // Sort buckets chronologically
  const buckets = Array.from(bucketMap.entries())
    .map(([bucket, counts]) => ({ bucket, counts }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  // Build theme metadata list (only themes that appear in data)
  const seenThemeIds = new Set<string>();
  for (const { counts } of buckets) {
    for (const tid of Object.keys(counts)) {
      seenThemeIds.add(tid);
    }
  }

  const themes = Array.from(seenThemeIds).map((id) => ({
    themeId: id,
    themeName: themeMap.get(id) ?? "Unknown",
  }));

  return { themes, buckets };
}

async function handleThemeClientMatrix(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // Need client names — fetch from sessions join with clients
  const [themeMap, rows, clientData] = await Promise.all([
    fetchActiveThemeMap(supabase, filters.teamId),
    fetchSignalThemeRows(supabase, filters),
    (async () => {
      const q = baseClientQuery(
        supabase
          .from("clients")
          .select("id, name")
          .order("name", { ascending: true }),
        filters
      );
      const { data, error } = await q;
      if (error) {
        console.error(`${LOG_PREFIX} theme_client_matrix client fetch error:`, error);
        throw new Error("Failed to fetch clients for theme matrix");
      }
      return (data ?? []) as Array<{ id: string; name: string }>;
    })(),
  ]);

  const clientMap = new Map<string, string>();
  for (const c of clientData) {
    clientMap.set(c.id, c.name);
  }

  // Group by (theme_id, client_id) — sparse cells
  const cellMap = new Map<string, number>(); // "themeId|clientId" → count
  const seenThemeIds = new Set<string>();
  const seenClientIds = new Set<string>();

  for (const row of rows) {
    const tid = row.theme_id;
    if (!themeMap.has(tid)) continue;

    const clientId = row.session_embeddings.sessions.client_id;
    if (!clientMap.has(clientId)) continue;

    const key = `${tid}|${clientId}`;
    cellMap.set(key, (cellMap.get(key) ?? 0) + 1);
    seenThemeIds.add(tid);
    seenClientIds.add(clientId);
  }

  const themesList = Array.from(seenThemeIds).map((id) => ({
    id,
    name: themeMap.get(id) ?? "Unknown",
  }));

  const clientsList = Array.from(seenClientIds).map((id) => ({
    id,
    name: clientMap.get(id) ?? "Unknown",
  }));

  const cells = Array.from(cellMap.entries()).map(([key, count]) => {
    const [themeId, clientId] = key.split("|");
    return { themeId, clientId, count };
  });

  return { themes: themesList, clients: clientsList, cells };
}

/**
 * Truncates a date to the start of its week (Monday) or month.
 * Returns an ISO date string (YYYY-MM-DD).
 */
function dateTrunc(granularity: "week" | "month", date: Date): string {
  if (granularity === "month") {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  }
  // Week: truncate to Monday
  const day = date.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - diff);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Drill-down action handler (PRD-021 Part 4)
// ---------------------------------------------------------------------------

/** Zod schema for the drill-down JSON payload — discriminated union on `type`. */
const drillDownSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sentiment"),
    value: z.enum(["positive", "negative", "neutral", "mixed"]),
  }),
  z.object({
    type: z.literal("urgency"),
    value: z.enum(["low", "medium", "high", "critical"]),
  }),
  z.object({
    type: z.literal("client"),
    clientId: z.string().min(1),
    clientName: z.string().min(1),
  }),
  z.object({
    type: z.literal("competitor"),
    competitor: z.string().min(1),
  }),
  z.object({
    type: z.literal("theme"),
    themeId: z.string().min(1),
    themeName: z.string().min(1),
  }),
  z.object({
    type: z.literal("theme_bucket"),
    themeId: z.string().min(1),
    themeName: z.string().min(1),
    bucket: z.string().min(1),
  }),
  z.object({
    type: z.literal("theme_client"),
    themeId: z.string().min(1),
    themeName: z.string().min(1),
    clientId: z.string().min(1),
    clientName: z.string().min(1),
  }),
]);

/** Max signals returned by a drill-down query. */
const DRILL_DOWN_LIMIT = 100;

/**
 * Builds the filter label displayed in the drill-down panel header.
 */
function buildFilterLabel(
  ctx: z.infer<typeof drillDownSchema>
): string {
  switch (ctx.type) {
    case "sentiment":
      return `Sentiment: ${ctx.value.charAt(0).toUpperCase() + ctx.value.slice(1)}`;
    case "urgency":
      return `Urgency: ${ctx.value.charAt(0).toUpperCase() + ctx.value.slice(1)}`;
    case "client":
      return `Client: ${ctx.clientName}`;
    case "competitor":
      return `Competitor: ${ctx.competitor}`;
    case "theme":
      return `Theme: ${ctx.themeName}`;
    case "theme_bucket":
      return `Theme: ${ctx.themeName} (${ctx.bucket})`;
    case "theme_client":
      return `Theme: ${ctx.themeName} + Client: ${ctx.clientName}`;
  }
}

/**
 * Groups flat signal rows by client, enforcing the DRILL_DOWN_LIMIT cap.
 * Returns the grouped response shape expected by DrillDownResult.
 */
function groupByClient(
  rows: Array<{
    embeddingId: string;
    sessionId: string;
    sessionDate: string;
    chunkText: string;
    chunkType: string;
    themeName: string | null;
    metadata: Record<string, unknown>;
    clientId: string;
    clientName: string;
  }>,
  filterLabel: string
): Record<string, unknown> {
  const totalSignals = rows.length;

  // Cap at DRILL_DOWN_LIMIT (rows are already sorted by session_date desc)
  const capped = rows.slice(0, DRILL_DOWN_LIMIT);

  const clientMap = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      signals: Array<{
        embeddingId: string;
        sessionId: string;
        sessionDate: string;
        chunkText: string;
        chunkType: string;
        themeName: string | null;
        metadata: Record<string, unknown>;
      }>;
    }
  >();

  for (const row of capped) {
    let group = clientMap.get(row.clientId);
    if (!group) {
      group = {
        clientId: row.clientId,
        clientName: row.clientName,
        signals: [],
      };
      clientMap.set(row.clientId, group);
    }
    group.signals.push({
      embeddingId: row.embeddingId,
      sessionId: row.sessionId,
      sessionDate: row.sessionDate,
      chunkText: row.chunkText,
      chunkType: row.chunkType,
      themeName: row.themeName,
      metadata: row.metadata,
    });
  }

  const clients = Array.from(clientMap.values())
    .map((g) => ({
      ...g,
      signalCount: g.signals.length,
    }))
    .sort((a, b) => b.signalCount - a.signalCount);

  return {
    filterLabel,
    totalSignals,
    totalClients: clients.length,
    clients,
  };
}

// ---- Direct drill-down helpers (sentiment, urgency, client, competitor) ----

/**
 * Fetches session_embeddings joined to sessions → clients for direct widget
 * drill-downs. Applies global filters (team, date range, client IDs) and
 * returns flat signal rows sorted by session_date descending.
 */
async function fetchDirectDrillDownRows(
  supabase: SupabaseClient,
  filters: QueryFilters,
  sessionFilter: {
    jsonField?: string;
    jsonValue?: string;
    clientId?: string;
  }
): Promise<
  Array<{
    embeddingId: string;
    sessionId: string;
    sessionDate: string;
    chunkText: string;
    chunkType: string;
    themeName: string | null;
    metadata: Record<string, unknown>;
    clientId: string;
    clientName: string;
  }>
> {
  // Step 1: Get matching sessions
  let sessionQuery = baseSessionQuery(
    supabase
      .from("sessions")
      .select("id, session_date, client_id, structured_json, clients(name)")
      .not("structured_json", "is", null)
      .order("session_date", { ascending: false }),
    filters
  );

  if (sessionFilter.clientId) {
    sessionQuery = sessionQuery.eq("client_id", sessionFilter.clientId);
  }

  const { data: sessions, error: sessError } = await sessionQuery;
  if (sessError) {
    console.error(`${LOG_PREFIX} drill_down session fetch error:`, sessError);
    throw new Error("Failed to fetch drill-down sessions");
  }

  if (!sessions || sessions.length === 0) return [];

  // Step 2: Filter sessions by JSON field if needed
  type SessionRow = {
    id: string;
    session_date: string;
    client_id: string;
    structured_json: Record<string, unknown> | null;
    clients: { name: string } | null;
  };

  let filtered = sessions as SessionRow[];
  if (sessionFilter.jsonField && sessionFilter.jsonValue) {
    filtered = filtered.filter((s) => {
      const val = s.structured_json?.[sessionFilter.jsonField!] as
        | string
        | undefined;
      return val === sessionFilter.jsonValue;
    });
  }

  if (filtered.length === 0) return [];

  const sessionIds = filtered.map((s) => s.id);
  const sessionLookup = new Map<string, SessionRow>();
  for (const s of filtered) {
    sessionLookup.set(s.id, s);
  }

  // Step 3: Fetch embeddings for matching sessions
  let embeddingQuery = supabase
    .from("session_embeddings")
    .select("id, session_id, chunk_text, chunk_type, metadata")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });

  // Team scoping on embeddings
  if (filters.teamId) {
    embeddingQuery = embeddingQuery.eq("team_id", filters.teamId);
  } else {
    embeddingQuery = embeddingQuery.is("team_id", null);
  }

  const { data: embeddings, error: embError } = await embeddingQuery;
  if (embError) {
    console.error(`${LOG_PREFIX} drill_down embedding fetch error:`, embError);
    throw new Error("Failed to fetch drill-down embeddings");
  }

  // Step 4: Merge into flat rows
  const rows: Array<{
    embeddingId: string;
    sessionId: string;
    sessionDate: string;
    chunkText: string;
    chunkType: string;
    themeName: string | null;
    metadata: Record<string, unknown>;
    clientId: string;
    clientName: string;
  }> = [];

  for (const emb of embeddings ?? []) {
    const embRow = emb as {
      id: string;
      session_id: string;
      chunk_text: string;
      chunk_type: string;
      metadata: Record<string, unknown> | null;
    };
    const session = sessionLookup.get(embRow.session_id);
    if (!session) continue;

    rows.push({
      embeddingId: embRow.id,
      sessionId: embRow.session_id,
      sessionDate: session.session_date,
      chunkText: embRow.chunk_text,
      chunkType: embRow.chunk_type,
      themeName: null, // direct drill-downs don't carry theme info
      metadata: embRow.metadata ?? {},
      clientId: session.client_id,
      clientName: session.clients?.name ?? "Unknown",
    });
  }

  return rows;
}

/**
 * Handles the competitor drill-down variant. Filters sessions that mention the
 * competitor in structured_json.competitiveMentions, then fetches embeddings
 * with chunk_type = 'competitive_mention' whose metadata matches.
 */
async function handleCompetitorDrillDown(
  supabase: SupabaseClient,
  filters: QueryFilters,
  competitor: string
): Promise<
  Array<{
    embeddingId: string;
    sessionId: string;
    sessionDate: string;
    chunkText: string;
    chunkType: string;
    themeName: string | null;
    metadata: Record<string, unknown>;
    clientId: string;
    clientName: string;
  }>
> {
  // Step 1: Get sessions with structured_json
  const sessionQuery = baseSessionQuery(
    supabase
      .from("sessions")
      .select("id, session_date, client_id, structured_json, clients(name)")
      .not("structured_json", "is", null)
      .order("session_date", { ascending: false }),
    filters
  );

  const { data: sessions, error: sessError } = await sessionQuery;
  if (sessError) {
    console.error(
      `${LOG_PREFIX} drill_down competitor session fetch error:`,
      sessError
    );
    throw new Error("Failed to fetch drill-down sessions for competitor");
  }

  if (!sessions || sessions.length === 0) return [];

  type SessionRow = {
    id: string;
    session_date: string;
    client_id: string;
    structured_json: Record<string, unknown> | null;
    clients: { name: string } | null;
  };

  // Step 2: Filter to sessions mentioning this competitor
  const matchingSessions = (sessions as SessionRow[]).filter((s) => {
    const mentions = s.structured_json?.competitiveMentions as
      | Array<{ competitor?: string }>
      | undefined;
    if (!mentions) return false;
    return mentions.some(
      (m) => m.competitor?.toLowerCase() === competitor.toLowerCase()
    );
  });

  if (matchingSessions.length === 0) return [];

  const sessionIds = matchingSessions.map((s) => s.id);
  const sessionLookup = new Map<string, SessionRow>();
  for (const s of matchingSessions) {
    sessionLookup.set(s.id, s);
  }

  // Step 3: Fetch competitive_mention embeddings for these sessions
  let embeddingQuery = supabase
    .from("session_embeddings")
    .select("id, session_id, chunk_text, chunk_type, metadata")
    .in("session_id", sessionIds)
    .eq("chunk_type", "competitive_mention")
    .order("created_at", { ascending: false });

  if (filters.teamId) {
    embeddingQuery = embeddingQuery.eq("team_id", filters.teamId);
  } else {
    embeddingQuery = embeddingQuery.is("team_id", null);
  }

  const { data: embeddings, error: embError } = await embeddingQuery;
  if (embError) {
    console.error(
      `${LOG_PREFIX} drill_down competitor embedding fetch error:`,
      embError
    );
    throw new Error("Failed to fetch drill-down embeddings for competitor");
  }

  // Step 4: Filter embeddings whose metadata references this competitor
  const rows: Array<{
    embeddingId: string;
    sessionId: string;
    sessionDate: string;
    chunkText: string;
    chunkType: string;
    themeName: string | null;
    metadata: Record<string, unknown>;
    clientId: string;
    clientName: string;
  }> = [];

  for (const emb of embeddings ?? []) {
    const embRow = emb as {
      id: string;
      session_id: string;
      chunk_text: string;
      chunk_type: string;
      metadata: Record<string, unknown> | null;
    };

    // Check metadata for competitor match
    const meta = embRow.metadata ?? {};
    const embCompetitor = (meta.competitor as string) ?? "";
    if (embCompetitor.toLowerCase() !== competitor.toLowerCase()) continue;

    const session = sessionLookup.get(embRow.session_id);
    if (!session) continue;

    rows.push({
      embeddingId: embRow.id,
      sessionId: embRow.session_id,
      sessionDate: session.session_date,
      chunkText: embRow.chunk_text,
      chunkType: embRow.chunk_type,
      themeName: null,
      metadata: meta,
      clientId: session.client_id,
      clientName: session.clients?.name ?? "Unknown",
    });
  }

  return rows;
}

// ---- Theme drill-down helpers (theme, theme_bucket, theme_client) ----------

/**
 * Fetches signals assigned to a theme via signal_themes → session_embeddings →
 * sessions → clients. Optionally narrows by date bucket or client.
 */
async function fetchThemeDrillDownRows(
  supabase: SupabaseClient,
  filters: QueryFilters,
  themeId: string,
  opts?: { bucket?: string; clientId?: string }
): Promise<
  Array<{
    embeddingId: string;
    sessionId: string;
    sessionDate: string;
    chunkText: string;
    chunkType: string;
    themeName: string | null;
    metadata: Record<string, unknown>;
    clientId: string;
    clientName: string;
  }>
> {
  // Resolve theme name
  const themeMap = await fetchActiveThemeMap(supabase, filters.teamId);
  const themeName = themeMap.get(themeId) ?? null;

  // Query signal_themes with nested joins
  let query = supabase
    .from("signal_themes")
    .select(
      `
      embedding_id,
      confidence,
      session_embeddings!inner(
        id,
        chunk_text,
        chunk_type,
        metadata,
        session_id,
        team_id,
        sessions!inner(
          session_date,
          client_id,
          deleted_at,
          clients(name)
        )
      )
    `
    )
    .eq("theme_id", themeId)
    .is("session_embeddings.sessions.deleted_at", null);

  // Team scoping
  if (filters.teamId) {
    query = query.eq("session_embeddings.team_id", filters.teamId);
  } else {
    query = query.is("session_embeddings.team_id", null);
  }

  // Global date range
  if (filters.dateFrom) {
    query = query.gte(
      "session_embeddings.sessions.session_date",
      filters.dateFrom
    );
  }
  if (filters.dateTo) {
    query = query.lte(
      "session_embeddings.sessions.session_date",
      filters.dateTo
    );
  }

  // Global client IDs
  if (filters.clientIds && filters.clientIds.length > 0) {
    query = query.in(
      "session_embeddings.sessions.client_id",
      filters.clientIds
    );
  }

  // Confidence threshold
  if (filters.confidenceMin !== undefined) {
    query = query.gte("confidence", filters.confidenceMin);
  }

  // Theme-client drill-down: narrow to specific client
  if (opts?.clientId) {
    query = query.eq(
      "session_embeddings.sessions.client_id",
      opts.clientId
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${LOG_PREFIX} drill_down theme fetch error:`, error);
    throw new Error("Failed to fetch drill-down data for theme");
  }

  // Parse nested join results
  type ThemeDrillRow = {
    embedding_id: string;
    confidence: number | null;
    session_embeddings: {
      id: string;
      chunk_text: string;
      chunk_type: string;
      metadata: Record<string, unknown> | null;
      session_id: string;
      sessions: {
        session_date: string;
        client_id: string;
        deleted_at: string | null;
        clients: { name: string } | null;
      };
    };
  };

  const typedRows = (data ?? []) as unknown as ThemeDrillRow[];
  const granularity = filters.granularity ?? "week";

  const rows: Array<{
    embeddingId: string;
    sessionId: string;
    sessionDate: string;
    chunkText: string;
    chunkType: string;
    themeName: string | null;
    metadata: Record<string, unknown>;
    clientId: string;
    clientName: string;
  }> = [];

  for (const row of typedRows) {
    const emb = row.session_embeddings;
    const session = emb.sessions;

    // Theme-bucket drill-down: narrow to the clicked time bucket
    if (opts?.bucket) {
      const rowBucket = dateTrunc(
        granularity,
        new Date(session.session_date)
      );
      if (rowBucket !== opts.bucket) continue;
    }

    rows.push({
      embeddingId: emb.id,
      sessionId: emb.session_id,
      sessionDate: session.session_date,
      chunkText: emb.chunk_text,
      chunkType: emb.chunk_type,
      themeName,
      metadata: emb.metadata ?? {},
      clientId: session.client_id,
      clientName: session.clients?.name ?? "Unknown",
    });
  }

  // Sort by session_date descending
  rows.sort(
    (a, b) =>
      new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime()
  );

  return rows;
}

/**
 * Main drill-down handler. Parses the drillDown JSON, dispatches to the
 * appropriate strategy, groups results by client, and returns the response.
 */
async function handleDrillDown(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  if (!filters.drillDown) {
    throw new Error("drill_down action requires a drillDown filter");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(filters.drillDown);
  } catch {
    throw new Error("drillDown filter is not valid JSON");
  }

  const result = drillDownSchema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join(", ");
    throw new Error(`Invalid drillDown payload: ${msg}`);
  }

  const ctx = result.data;
  const filterLabel = buildFilterLabel(ctx);

  console.log(
    `${LOG_PREFIX} handleDrillDown — type: ${ctx.type}, label: "${filterLabel}"`
  );

  let rows: Array<{
    embeddingId: string;
    sessionId: string;
    sessionDate: string;
    chunkText: string;
    chunkType: string;
    themeName: string | null;
    metadata: Record<string, unknown>;
    clientId: string;
    clientName: string;
  }>;

  switch (ctx.type) {
    case "sentiment":
      rows = await fetchDirectDrillDownRows(supabase, filters, {
        jsonField: "sentiment",
        jsonValue: ctx.value,
      });
      break;
    case "urgency":
      rows = await fetchDirectDrillDownRows(supabase, filters, {
        jsonField: "urgency",
        jsonValue: ctx.value,
      });
      break;
    case "client":
      rows = await fetchDirectDrillDownRows(supabase, filters, {
        clientId: ctx.clientId,
      });
      break;
    case "competitor":
      rows = await handleCompetitorDrillDown(
        supabase,
        filters,
        ctx.competitor
      );
      break;
    case "theme":
      rows = await fetchThemeDrillDownRows(supabase, filters, ctx.themeId);
      break;
    case "theme_bucket":
      rows = await fetchThemeDrillDownRows(supabase, filters, ctx.themeId, {
        bucket: ctx.bucket,
      });
      break;
    case "theme_client":
      rows = await fetchThemeDrillDownRows(supabase, filters, ctx.themeId, {
        clientId: ctx.clientId,
      });
      break;
  }

  return groupByClient(rows, filterLabel);
}

// ---------------------------------------------------------------------------
// Session detail action handler (PRD-021 Part 4)
// ---------------------------------------------------------------------------

/**
 * Fetches a single session by ID with team scoping. Returns structured_json,
 * client_name, and session_date for the session preview dialog.
 */
async function handleSessionDetail(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  if (!filters.sessionId) {
    throw new Error("session_detail action requires a sessionId filter");
  }

  console.log(
    `${LOG_PREFIX} handleSessionDetail — sessionId: ${filters.sessionId}`
  );

  let query = supabase
    .from("sessions")
    .select("id, session_date, structured_json, clients(name)")
    .eq("id", filters.sessionId)
    .is("deleted_at", null);

  query = scopeByTeam(query, filters.teamId);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error(`${LOG_PREFIX} session_detail error:`, error);
    throw new Error("Failed to fetch session detail");
  }

  if (!data) {
    throw new Error("Session not found");
  }

  const row = data as unknown as {
    id: string;
    session_date: string;
    structured_json: Record<string, unknown> | null;
    clients: { name: string } | null;
  };

  return {
    sessionId: row.id,
    sessionDate: row.session_date,
    clientName: row.clients?.name ?? "Unknown",
    structuredJson: row.structured_json,
  };
}

// ---------------------------------------------------------------------------
// Insight action handlers (PRD-021 Part 5)
// ---------------------------------------------------------------------------

/**
 * Fetch the most recent batch of insights for the current workspace.
 * Two-step query: find the latest batch_id, then fetch all rows for it.
 */
async function handleInsightsLatest(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // Step 1: find latest batch_id
  const latestQuery = filters.teamId
    ? supabase
        .from("dashboard_insights")
        .select("batch_id, generated_at")
        .eq("team_id", filters.teamId)
        .order("generated_at", { ascending: false })
        .limit(1)
    : supabase
        .from("dashboard_insights")
        .select("batch_id, generated_at")
        .is("team_id", null)
        .order("generated_at", { ascending: false })
        .limit(1);

  const { data: latestRow, error: latestErr } = await latestQuery;

  if (latestErr) {
    console.error(`${LOG_PREFIX} insights_latest — error finding latest:`, latestErr.message);
    throw new Error("Failed to find latest insight batch");
  }

  if (!latestRow || latestRow.length === 0) {
    return { batch: null };
  }

  const batchId = (latestRow[0] as unknown as { batch_id: string }).batch_id;
  const generatedAt = (latestRow[0] as unknown as { generated_at: string }).generated_at;

  // Step 2: fetch all rows for that batch
  const batchQuery = filters.teamId
    ? supabase
        .from("dashboard_insights")
        .select("*")
        .eq("team_id", filters.teamId)
        .eq("batch_id", batchId)
    : supabase
        .from("dashboard_insights")
        .select("*")
        .is("team_id", null)
        .eq("batch_id", batchId);

  const { data, error } = await batchQuery;

  if (error) {
    console.error(`${LOG_PREFIX} insights_latest — error fetching batch:`, error.message);
    throw new Error("Failed to fetch latest insight batch");
  }

  const insights = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    content: row.content,
    insightType: row.insight_type,
    batchId: row.batch_id,
    teamId: row.team_id,
    createdBy: row.created_by,
    generatedAt: row.generated_at,
  }));

  return {
    batch: {
      batchId,
      generatedAt,
      insights,
    },
  };
}

/**
 * Fetch previous insight batches (excluding the latest), grouped by batch_id.
 * Returns up to 10 batches ordered by generated_at DESC.
 */
async function handleInsightsHistory(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = filters.teamId
    ? supabase
        .from("dashboard_insights")
        .select("*")
        .eq("team_id", filters.teamId)
        .order("generated_at", { ascending: false })
    : supabase
        .from("dashboard_insights")
        .select("*")
        .is("team_id", null)
        .order("generated_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} insights_history — error:`, error.message);
    throw new Error("Failed to fetch insight history");
  }

  // Group rows by batch_id, preserving order
  const batchMap = new Map<string, { generatedAt: string; insights: Record<string, unknown>[] }>();
  const batchOrder: string[] = [];

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const bid = row.batch_id as string;
    let batch = batchMap.get(bid);
    if (!batch) {
      batch = {
        generatedAt: row.generated_at as string,
        insights: [],
      };
      batchMap.set(bid, batch);
      batchOrder.push(bid);
    }
    batch.insights.push({
      id: row.id,
      content: row.content,
      insightType: row.insight_type,
      batchId: row.batch_id,
      teamId: row.team_id,
      createdBy: row.created_by,
      generatedAt: row.generated_at,
    });
  }

  // Skip the latest batch, take up to 10
  const batches = batchOrder
    .slice(1, 11)
    .map((bid) => ({
      batchId: bid,
      generatedAt: batchMap.get(bid)!.generatedAt,
      insights: batchMap.get(bid)!.insights,
    }));

  return { batches };
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
  // Theme widget actions (PRD-021 Part 3)
  top_themes: handleTopThemes,
  theme_trends: handleThemeTrends,
  theme_client_matrix: handleThemeClientMatrix,
  // Drill-down actions (PRD-021 Part 4)
  drill_down: handleDrillDown,
  session_detail: handleSessionDetail,
  // Insight actions (PRD-021 Part 5)
  insights_latest: handleInsightsLatest,
  insights_history: handleInsightsHistory,
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
      confidenceMin: filters.confidenceMin,
      drillDown: filters.drillDown ? "(present)" : undefined,
      sessionId: filters.sessionId,
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
