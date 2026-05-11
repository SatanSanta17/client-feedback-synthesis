import { tool } from "ai";
import { z } from "zod";

import {
  aggregate,
  type AggregateDim,
} from "@/lib/services/chat-tool-services/aggregation-service";

import { chunkTypeEnum } from "./shared/chunk-type-enum";
import { sanitiseAggregate } from "./shared/filter-sanitiser";
import type { ChatToolContext } from "./shared/tool-context";

const dimEnum = z.enum([
  "client",
  "theme",
  "sentiment",
  "urgency",
  "severity",
  "chunkType",
]);

const inputSchema = z.object({
  entity: z
    .enum(["sessions", "signals", "clients"])
    .describe("What to count: 'clients' for client counts, 'sessions' for session counts, 'signals' for chunk-level counts."),
  groupBy: z
    .union([dimEnum, z.array(dimEnum).max(2)])
    .optional()
    .describe(
      "Optional dimension(s) to group by. Single-dim returns a ranked distribution; two-dim returns a flat array of {dimensions, count} rows that you can pivot into a matrix. Omit for a plain count."
    ),
  clientName: z
    .string()
    .optional()
    .describe("Filter by client. OMIT unless the user names a client."),
  dateFrom: z.string().optional().describe("ISO date — start of window."),
  dateTo: z.string().optional().describe("ISO date — end of window."),
  themeName: z.string().optional().describe("Filter by theme name."),
  chunkTypes: z
    .array(chunkTypeEnum)
    .optional()
    .describe("Filter by chunk types (only valid for entity='signals')."),
  severity: z.enum(["low", "medium", "high"]).optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
  confidenceMin: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Min theme-assignment confidence (used by theme aggregations)."),
});

export function createAggregateTool(ctx: ChatToolContext) {
  return tool({
    description:
      "Count an entity (sessions / signals / clients) with optional groupBy. " +
      "Use this to answer all quantitative questions: 'how many sessions?', 'sentiment distribution', 'top themes', 'session count by client', 'theme×client matrix'. " +
      "Examples:\n" +
      "  - 'How many sessions?' → entity=sessions, no groupBy\n" +
      "  - 'Top themes this month' → entity=signals, groupBy=theme, dateFrom=...\n" +
      "  - 'Sessions by sentiment' → entity=sessions, groupBy=sentiment\n" +
      "  - 'Theme by client matrix' → entity=signals, groupBy=[theme, client]",
    inputSchema,
    execute: async (input) => {
      const sanitised = sanitiseAggregate(input, ctx.lastUserMessage, ctx.resolvedNames);
      ctx.emitStatus("Aggregating data…");
      const result = await aggregate(
        {
          entity: sanitised.entity,
          groupBy: sanitised.groupBy as AggregateDim | AggregateDim[] | undefined,
          filters: {
            teamId: ctx.workspace.teamId,
            userId: ctx.workspace.userId,
            clientName: sanitised.clientName,
            dateFrom: sanitised.dateFrom,
            dateTo: sanitised.dateTo,
            themeName: sanitised.themeName,
            chunkTypes: sanitised.chunkTypes,
            severity: sanitised.severity,
            urgency: sanitised.urgency,
            confidenceMin: sanitised.confidenceMin,
          },
        },
        { supabase: ctx.supabaseClient }
      );
      return result;
    },
  });
}
