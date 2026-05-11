import { tool } from "ai";
import { z } from "zod";

import { getInsightsHistory } from "@/lib/services/chat-tool-services/insights-service";

import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({});

export function createInsightsHistoryTool(ctx: ChatToolContext) {
  return tool({
    description:
      "Fetch historical batches of dashboard insight cards. " +
      "Use when the user asks for older insights or wants to compare insights over time.",
    inputSchema,
    execute: async () => {
      ctx.emitStatus("Fetching insights history…");
      return getInsightsHistory(
        { teamId: ctx.workspace.teamId },
        { supabase: ctx.supabaseClient }
      );
    },
  });
}
