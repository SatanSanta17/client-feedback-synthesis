// ---------------------------------------------------------------------------
// Database Query — Public Surface
// ---------------------------------------------------------------------------
// Single entry point for the three external consumers of this module:
//   - app/api/dashboard/route.ts
//   - lib/services/chat-stream-service.ts
//   - lib/services/insight-service.ts
//
// Adding a new action requires editing the relevant domain module under
// ./domains/, the registry in ./action-metadata.ts, and the action map in
// ./execute-query.ts. The dev-time `assertChatToolActionsInSync` check (in
// action-metadata.ts) prevents tuple/registry drift on import.
// ---------------------------------------------------------------------------

export { executeQuery } from "./execute-query";
export type {
  ActionMeta,
  DatabaseQueryResult,
  QueryAction,
  QueryFilters,
} from "./types";
export {
  ACTION_METADATA,
  CHAT_TOOL_ACTIONS,
  buildChatToolDescription,
  type ChatToolAction,
} from "./action-metadata";
