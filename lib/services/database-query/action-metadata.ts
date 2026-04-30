// ---------------------------------------------------------------------------
// Database Query — Action Metadata Registry
// ---------------------------------------------------------------------------
// Single source of truth for which actions the LLM can invoke via the chat
// `queryDatabase` tool, plus per-action descriptions surfaced to the model.
// Adding a new entry to QueryAction produces a TypeScript error in
// ACTION_METADATA until classified — drift is structurally prevented.
//
// `llmToolExposed: false` means the action is reachable via direct API or UI
// fetch but is NOT offered to the LLM as a tool choice. Notably,
// `session_detail` remains used by the chat citation dialog (a client-side
// fetch from `SessionPreviewDialog`) — the flag governs LLM tool exposure
// only; UI-driven and direct-API callers are unaffected. (Gap E4)
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

// Const-asserted tuple of actions exposed to the LLM. Used as the runtime
// source for the chat tool's Zod enum. Type-and-runtime parity with
// ACTION_METADATA is verified at module load by assertChatToolActionsInSync().
const CHAT_TOOL_ACTIONS_TUPLE = [
  "count_clients",
  "count_sessions",
  "sessions_per_client",
  "sentiment_distribution",
  "urgency_distribution",
  "recent_sessions",
  "client_list",
  "sessions_over_time",
  "client_health_grid",
  "competitive_mention_frequency",
  "top_themes",
  "theme_trends",
  "theme_client_matrix",
  "insights_latest",
  "insights_history",
] as const satisfies readonly QueryAction[];

export type ChatToolAction = (typeof CHAT_TOOL_ACTIONS_TUPLE)[number];
// Exported with the literal tuple type preserved (no widening) so consumers
// like `z.enum(CHAT_TOOL_ACTIONS)` get a valid non-empty tuple type.
export const CHAT_TOOL_ACTIONS = CHAT_TOOL_ACTIONS_TUPLE;

// Dev-time sanity: the static tuple must match the runtime filter of the
// registry. Catches the case where someone flips an `llmToolExposed` flag in
// ACTION_METADATA without updating the tuple (or vice versa). Throws on
// module load in non-production builds; never trips in production paths.
function assertChatToolActionsInSync() {
  const fromRegistry = (
    Object.entries(ACTION_METADATA) as [QueryAction, ActionMeta][]
  )
    .filter(([, meta]) => meta.llmToolExposed)
    .map(([action]) => action)
    .sort();
  const fromTuple = [...CHAT_TOOL_ACTIONS_TUPLE].sort();
  if (
    fromRegistry.length !== fromTuple.length ||
    fromRegistry.some((a, i) => a !== fromTuple[i])
  ) {
    throw new Error(
      `${LOG_PREFIX} CHAT_TOOL_ACTIONS_TUPLE is out of sync with ACTION_METADATA.\n` +
        `From registry (llmToolExposed=true): ${fromRegistry.join(", ")}\n` +
        `From tuple: ${fromTuple.join(", ")}`
    );
  }
}

if (process.env.NODE_ENV !== "production") {
  assertChatToolActionsInSync();
}

/**
 * Builds the `description` string surfaced to the LLM as the `queryDatabase`
 * tool description. Composes the preamble with a bulleted list of LLM-exposed
 * actions and their descriptions, sourced from ACTION_METADATA.
 */
export function buildChatToolDescription(): string {
  const lines = CHAT_TOOL_ACTIONS.map(
    (action) => `- ${action}: ${ACTION_METADATA[action].description}`
  );
  return [
    "Query the database for quantitative data about clients, sessions, themes, competitive mentions, and dashboard insights. Use when the question involves counts, lists, distributions, or factual lookups.",
    "",
    "Available actions:",
    ...lines,
  ].join("\n");
}
