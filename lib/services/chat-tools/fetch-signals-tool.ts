import { tool } from "ai";
import { z } from "zod";

import { fetchSignals } from "@/lib/services/chat-tool-services/signals-service";
import type { ChunkType } from "@/lib/types/embedding-chunk";

import { chunkTypeEnum } from "./shared/chunk-type-enum";
import { sanitiseFetchSignals } from "./shared/filter-sanitiser";
import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  clientName: z
    .string()
    .optional()
    .describe("Filter by exact client name (case-insensitive)."),
  themeName: z
    .string()
    .optional()
    .describe("Filter by exact theme name (case-insensitive)."),
  chunkTypes: z
    .array(chunkTypeEnum)
    .optional()
    .describe(
      "Filter by chunk type. OMIT unless the user asks for a specific category."
    ),
  severity: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe("Filter by severity tier. OMIT unless the user asks."),
  urgency: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe("Filter by urgency tier. OMIT unless the user asks."),
  dateFrom: z
    .string()
    .optional()
    .describe("Start date (ISO YYYY-MM-DD). OMIT unless the user specifies."),
  dateTo: z
    .string()
    .optional()
    .describe("End date (ISO YYYY-MM-DD). OMIT unless the user specifies."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Max signals to return (default 200)."),
});

export function createFetchSignalsTool(ctx: ChatToolContext) {
  return tool({
    description:
      "List structured signal chunks across sessions matching exact filters. Strictly filter-driven — no query string, no similarity ranking. " +
      "Use this for completeness questions ('every pain point about pricing', 'all competitive mentions involving Snowflake'). " +
      "Do NOT use for similarity / paraphrase questions ('what are clients saying about onboarding') — use semantic_search for those.",
    inputSchema,
    execute: async (input) => {
      const sanitised = sanitiseFetchSignals(input, ctx.lastUserMessage, ctx.resolvedNames);
      ctx.emitStatus("Fetching signals…");
      const result = await fetchSignals(
        {
          teamId: ctx.workspace.teamId,
          userId: ctx.workspace.userId,
          clientName: sanitised.clientName,
          themeName: sanitised.themeName,
          chunkTypes: sanitised.chunkTypes as ChunkType[] | undefined,
          severity: sanitised.severity,
          urgency: sanitised.urgency,
          dateFrom: sanitised.dateFrom,
          dateTo: sanitised.dateTo,
          limit: sanitised.limit,
        },
        { embeddingRepo: ctx.embeddingRepo }
      );
      return result;
    },
  });
}
