// ---------------------------------------------------------------------------
// Database Query Service (PRD-020 Part 2)
// ---------------------------------------------------------------------------
// Maps action strings to parameterized Supabase queries. The LLM never sees or
// generates SQL — it selects an action and provides filter values, and this
// service executes the corresponding safe query.
//
// Framework-agnostic: no HTTP or Next.js imports.
//
// PRD-023 P5 Increment 1: types, action metadata, and shared query helpers
// (severity-filter, base-query-builder, row-helpers, theme-helpers) have been
// extracted into ./database-query/. Handlers continue to live here pending
// Increments 2–5.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { scopeByTeam } from "@/lib/repositories/supabase/scope-by-team";

import { LOG_PREFIX } from "./database-query/action-metadata";
import {
  handleClientList,
  handleCountClients,
  handleCountSessions,
  handleSessionsPerClient,
} from "./database-query/domains/counts";
import {
  handleCompetitiveMentionFrequency,
  handleSentimentDistribution,
  handleUrgencyDistribution,
} from "./database-query/domains/distributions";
import { handleDrillDown } from "./database-query/domains/drilldown";
import {
  handleClientHealthGrid,
  handleRecentSessions,
  handleSessionsOverTime,
} from "./database-query/domains/sessions";
import {
  handleThemeClientMatrix,
  handleThemeTrends,
  handleTopThemes,
} from "./database-query/domains/themes";

import type {
  DatabaseQueryResult,
  QueryAction,
  QueryFilters,
} from "./database-query/types";

// ---------------------------------------------------------------------------
// Public re-exports — preserved verbatim for the three external consumers
// (app/api/dashboard/route.ts, lib/services/chat-stream-service.ts,
// lib/services/insight-service.ts). Increment 5 will swap consumer imports
// to ./database-query directly and delete this file.
// ---------------------------------------------------------------------------

export type {
  ActionMeta,
  DatabaseQueryResult,
  QueryAction,
  QueryFilters,
} from "./database-query/types";
export {
  ACTION_METADATA,
  CHAT_TOOL_ACTIONS,
  buildChatToolDescription,
  type ChatToolAction,
} from "./database-query/action-metadata";

// ---------------------------------------------------------------------------
// Action handlers — counts/distributions/sessions/themes/drill-down/insights.
// Moved domains live in ./database-query/domains/ (PRD-023 P5 Inc. 2–4).
// session_detail and insights are still inlined below pending Increment 5.
// ---------------------------------------------------------------------------

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
