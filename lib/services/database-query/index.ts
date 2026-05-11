// ---------------------------------------------------------------------------
// Database Query — Public Surface
// ---------------------------------------------------------------------------
// Single entry point for the external consumers of this module:
//   - app/api/dashboard/route.ts
//   - lib/services/insight-service.ts
//   - lib/services/chat-tool-services/aggregation-service.ts (PRD-033 Part 1)
//   - lib/services/chat-tool-services/insights-service.ts (PRD-033 Part 1)
//
// Adding a new action requires editing the relevant domain module under
// ./domains/, the ACTION_METADATA registry in ./action-metadata.ts, and the
// action map in ./execute-query.ts.
//
// PRD-033 Part 3 retired the chat-side CHAT_TOOL_ACTIONS / ChatToolAction /
// buildChatToolDescription exports; the chat surface now uses primitive
// tools (`lib/services/chat-tools/`) and reaches the dashboard's domain
// modules through the aggregation/insights services.
// ---------------------------------------------------------------------------

export { executeQuery } from "./execute-query";
export type {
  ActionMeta,
  DatabaseQueryResult,
  QueryAction,
  QueryFilters,
} from "./types";
export { ACTION_METADATA } from "./action-metadata";
