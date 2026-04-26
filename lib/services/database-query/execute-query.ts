// ---------------------------------------------------------------------------
// Database Query — Execute (thin router)
// ---------------------------------------------------------------------------
// Owns ACTION_MAP and the public `executeQuery` entry point. Every handler
// is imported from its domain module — this file contains no business logic.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { LOG_PREFIX } from "./action-metadata";
import {
  handleClientList,
  handleCountClients,
  handleCountSessions,
  handleSessionsPerClient,
} from "./domains/counts";
import {
  handleCompetitiveMentionFrequency,
  handleSentimentDistribution,
  handleUrgencyDistribution,
} from "./domains/distributions";
import { handleDrillDown } from "./domains/drilldown";
import {
  handleInsightsHistory,
  handleInsightsLatest,
} from "./domains/insights";
import { handleSessionDetail } from "./domains/session-detail";
import {
  handleClientHealthGrid,
  handleRecentSessions,
  handleSessionsOverTime,
} from "./domains/sessions";
import {
  handleThemeClientMatrix,
  handleThemeTrends,
  handleTopThemes,
} from "./domains/themes";
import type {
  DatabaseQueryResult,
  QueryAction,
  QueryFilters,
} from "./types";

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
