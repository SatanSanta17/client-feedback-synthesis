import { tool } from "ai";
import { z } from "zod";

import {
  timeSeries,
  type AggregateDim,
} from "@/lib/services/chat-tool-services/aggregation-service";

import { sanitiseTimeSeries } from "./shared/filter-sanitiser";
import type { ChatToolContext } from "./shared/tool-context";

const dimEnum = z.enum(["theme"]);

const inputSchema = z.object({
  entity: z
    .enum(["sessions", "signals"])
    .describe("What to count over time: 'sessions' for session counts; 'signals' for theme-tagged chunk counts."),
  granularity: z.enum(["week", "month"]).describe("Time bucket size."),
  groupBy: dimEnum
    .optional()
    .describe("Optional single-dim grouping. Currently 'theme' for theme trends."),
  clientName: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  themeName: z.string().optional(),
});

export function createTimeSeriesTool(ctx: ChatToolContext) {
  return tool({
    description:
      "Time-bucketed counts for sessions or theme-tagged signals. " +
      "Use for trend questions like 'sessions over time' or 'theme trends'. " +
      "Returns periodStart + count per bucket; with groupBy=theme each bucket also has a key (theme name).",
    inputSchema,
    execute: async (input) => {
      const sanitised = sanitiseTimeSeries(input, ctx.lastUserMessage);
      ctx.emitStatus("Computing time series…");
      const result = await timeSeries(
        {
          entity: sanitised.entity,
          granularity: sanitised.granularity,
          groupBy: sanitised.groupBy as AggregateDim | undefined,
          filters: {
            teamId: ctx.workspace.teamId,
            clientName: sanitised.clientName,
            dateFrom: sanitised.dateFrom,
            dateTo: sanitised.dateTo,
            themeName: sanitised.themeName,
          },
        },
        { supabase: ctx.supabaseClient }
      );
      return result;
    },
  });
}
