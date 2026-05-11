// ---------------------------------------------------------------------------
// Database Query — Action Metadata Registry
// ---------------------------------------------------------------------------
// Source of truth for the dashboard's action surface. Each entry carries a
// description used by dashboard tooling and (historically) by the chat tool
// description builder. PRD-033 Part 3 retired the chat-side
// CHAT_TOOL_ACTIONS / buildChatToolDescription / `llmToolExposed` flag; the
// chat surface now uses the primitive tool registry in `lib/services/
// chat-tools/` and reaches these actions via the aggregation + insights
// services.
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
    description: "Total number of clients in the workspace.",
  },
  count_sessions: {
    description:
      "Total number of sessions in the workspace. Honors `severity` (counts only sessions with at least one chunk of that severity).",
  },
  sessions_per_client: {
    description:
      "Session count grouped by client. Honors `severity` (counts only sessions with at least one chunk of that severity).",
  },
  sentiment_distribution: {
    description:
      "Count of signals by sentiment (positive / neutral / negative). Honors `severity` (restricts to sessions with at least one chunk of that severity before aggregating).",
  },
  urgency_distribution: {
    description:
      "Count of signals by urgency tier. Honors `severity` (restricts to sessions with at least one chunk of that severity before aggregating).",
  },
  recent_sessions: {
    description:
      "Most recent sessions, newest first. Honors `severity` (filters to sessions with at least one chunk of that severity).",
  },
  client_list: {
    description: "List of clients with metadata.",
  },
  sessions_over_time: {
    description:
      "Session volume over time, bucketed by `granularity`. Does NOT honor `severity` (RPC-based aggregation; deferred — see gap-analysis-trd.md E4).",
  },
  client_health_grid: {
    description:
      "Per-client health metrics for scatter-plot rendering. Honors `severity` and `urgency` post-filters.",
  },
  competitive_mention_frequency: {
    description:
      "How often each competitor is mentioned across signals. Does NOT honor `severity` (competitive mentions don't carry severity).",
  },
  top_themes: {
    description:
      "Most-common signal themes ranked by mention count. Honors `confidenceMin`, `severity` (restricts to sessions with at least one chunk of that severity).",
  },
  theme_trends: {
    description:
      "Theme mention counts over time. Honors `granularity`, `confidenceMin`, `severity`.",
  },
  theme_client_matrix: {
    description:
      "Theme × client cross-tabulation. Honors `confidenceMin`, `clientIds`, `severity`.",
  },
  recently_merged_themes: {
    description:
      "Used by dashboard theme widgets to render the 'Recently merged' indicator on canonical themes (PRD-026 Part 4). Not surfaced as a chat tool.",
  },
  drill_down: {
    description:
      "Payload-driven; used by dashboard widget clicks. Not surfaced as a chat tool.",
  },
  session_detail: {
    description:
      "Used by chat citation dialog and dashboard 'View Session' via direct API fetch with sessionId. Not surfaced as a chat tool.",
  },
  insights_latest: {
    description: "Most recent batch of AI-generated dashboard insight cards.",
  },
  insights_history: {
    description:
      "Historical batches of AI-generated insight cards (paginated by `batch_id`).",
  },
};
