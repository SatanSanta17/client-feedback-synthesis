// ---------------------------------------------------------------------------
// Database Query — Action Metadata Registry
// ---------------------------------------------------------------------------
// Source of truth for the dashboard's action surface. Each entry carries a
// description and a legacy `llmToolExposed` flag. The flag is preserved for
// historical reference but no longer drives any runtime behaviour — PRD-033
// Part 3 retired the chat tool's CHAT_TOOL_ACTIONS tuple and its sync check;
// the chat surface now uses the primitive tool registry in
// `lib/services/chat-tools/` and does not consume `llmToolExposed`.
// ---------------------------------------------------------------------------

import type { ActionMeta, QueryAction } from "./types";

/**
 * Log prefix used by every domain module and the executeQuery entry point.
 * Preserved verbatim from the pre-cleanup monolith so production grep,
 * alerting, and log-aggregation patterns continue to match.
 */
export const LOG_PREFIX = "[database-query-service]";

export const ACTION_METADATA: Record<QueryAction, ActionMeta> = {
  count_clients: {
    llmToolExposed: true,
    description: "Total number of clients in the workspace.",
  },
  count_sessions: {
    llmToolExposed: true,
    description:
      "Total number of sessions in the workspace. Honors `severity` (counts only sessions with at least one chunk of that severity).",
  },
  sessions_per_client: {
    llmToolExposed: true,
    description:
      "Session count grouped by client. Honors `severity` (counts only sessions with at least one chunk of that severity).",
  },
  sentiment_distribution: {
    llmToolExposed: true,
    description:
      "Count of signals by sentiment (positive / neutral / negative). Honors `severity` (restricts to sessions with at least one chunk of that severity before aggregating).",
  },
  urgency_distribution: {
    llmToolExposed: true,
    description:
      "Count of signals by urgency tier. Honors `severity` (restricts to sessions with at least one chunk of that severity before aggregating).",
  },
  recent_sessions: {
    llmToolExposed: true,
    description:
      "Most recent sessions, newest first. Honors `severity` (filters to sessions with at least one chunk of that severity).",
  },
  client_list: {
    llmToolExposed: true,
    description: "List of clients with metadata.",
  },
  sessions_over_time: {
    llmToolExposed: true,
    description:
      "Session volume over time, bucketed by `granularity`. Does NOT honor `severity` (RPC-based aggregation; deferred — see gap-analysis-trd.md E4).",
  },
  client_health_grid: {
    llmToolExposed: true,
    description:
      "Per-client health metrics for scatter-plot rendering. Honors `severity` and `urgency` post-filters.",
  },
  competitive_mention_frequency: {
    llmToolExposed: true,
    description:
      "How often each competitor is mentioned across signals. Does NOT honor `severity` (competitive mentions don't carry severity).",
  },
  top_themes: {
    llmToolExposed: true,
    description:
      "Most-common signal themes ranked by mention count. Honors `confidenceMin`, `severity` (restricts to sessions with at least one chunk of that severity).",
  },
  theme_trends: {
    llmToolExposed: true,
    description:
      "Theme mention counts over time. Honors `granularity`, `confidenceMin`, `severity`.",
  },
  theme_client_matrix: {
    llmToolExposed: true,
    description:
      "Theme × client cross-tabulation. Honors `confidenceMin`, `clientIds`, `severity`.",
  },
  recently_merged_themes: {
    llmToolExposed: false,
    description:
      "(not exposed — used by dashboard theme widgets to render the 'Recently merged' indicator on canonical themes; PRD-026 Part 4)",
  },
  drill_down: {
    llmToolExposed: false,
    description:
      "(not exposed — payload-driven; used by dashboard widget clicks)",
  },
  session_detail: {
    llmToolExposed: false,
    description:
      "(not exposed — used by chat citation dialog and dashboard 'View Session' via direct API fetch with sessionId)",
  },
  insights_latest: {
    llmToolExposed: true,
    description: "Most recent batch of AI-generated dashboard insight cards.",
  },
  insights_history: {
    llmToolExposed: true,
    description:
      "Historical batches of AI-generated insight cards (paginated by `batch_id`).",
  },
};

