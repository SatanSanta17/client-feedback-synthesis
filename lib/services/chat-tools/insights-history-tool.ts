import { tool } from "ai";
import { z } from "zod";

import { getInsightsHistory } from "@/lib/services/chat-tool-services/insights-service";

import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor (batch_id) — pass the cursor from a prior call to fetch the next page."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max insight cards to return (default: backend default)."),
});

export function createInsightsHistoryTool(ctx: ChatToolContext) {
  return tool({
    description:
      "Fetch historical batches of dashboard insight cards. " +
      "Use when the user asks for older insights or wants to compare insights over time.",
    inputSchema,
    execute: async (input) => {
      ctx.emitStatus("Fetching insights history…");
      return getInsightsHistory(
        { teamId: ctx.workspace.teamId, cursor: input.cursor, limit: input.limit },
        { supabase: ctx.supabaseClient }
      );
    },
  });
}
