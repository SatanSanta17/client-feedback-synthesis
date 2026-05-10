// ---------------------------------------------------------------------------
// Chat Tools — Registry.
// PRD-033 Part 1 / TRD § 1.4. Returns a Record<toolName, Tool> spread into
// streamText({ tools }). Per P1.AC9, this registry is NOT yet wired into
// chat-stream-service.ts at the end of Part 1; the Part 3 cutover commit
// makes the swap.
// ---------------------------------------------------------------------------

import { createAggregateTool } from "./aggregate-tool";
import { createFetchSessionContentTool } from "./fetch-session-content-tool";
import { createFetchSignalsTool } from "./fetch-signals-tool";
import { createInsightsHistoryTool } from "./insights-history-tool";
import { createInsightsLatestTool } from "./insights-latest-tool";
import { createListClientsTool } from "./list-clients-tool";
import { createListSessionsTool } from "./list-sessions-tool";
import { createListThemesTool } from "./list-themes-tool";
import { createSemanticSearchTool } from "./semantic-search-tool";
import type { ChatToolContext } from "./shared/tool-context";
import { createSummariseSessionsTool } from "./summarise-sessions-tool";
import { createTimeSeriesTool } from "./time-series-tool";

export type { ChatToolContext, WorkspaceCtx } from "./shared/tool-context";

export function createChatTools(ctx: ChatToolContext) {
  return {
    list_clients: createListClientsTool(ctx),
    list_sessions: createListSessionsTool(ctx),
    list_themes: createListThemesTool(ctx),
    semantic_search: createSemanticSearchTool(ctx),
    fetch_session_content: createFetchSessionContentTool(ctx),
    fetch_signals: createFetchSignalsTool(ctx),
    aggregate: createAggregateTool(ctx),
    time_series: createTimeSeriesTool(ctx),
    summarise_sessions: createSummariseSessionsTool(ctx),
    insights_latest: createInsightsLatestTool(ctx),
    insights_history: createInsightsHistoryTool(ctx),
  } as const;
}
