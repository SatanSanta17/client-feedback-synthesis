import { tool } from "ai";
import { z } from "zod";

import { listSessions } from "@/lib/services/chat-tool-services/discovery-service";

import { chunkTypeEnum } from "./shared/chunk-type-enum";
import { sanitiseListSessions } from "./shared/filter-sanitiser";
import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  clientName: z
    .string()
    .optional()
    .describe(
      "Filter to a single client by exact (case-insensitive) name. OMIT unless the user names one."
    ),
  dateFrom: z
    .string()
    .optional()
    .describe(
      "Start date (ISO YYYY-MM-DD). OMIT unless the user explicitly specifies a start date."
    ),
  dateTo: z
    .string()
    .optional()
    .describe(
      "End date (ISO YYYY-MM-DD). OMIT unless the user explicitly specifies an end date."
    ),
  sentiment: z
    .enum(["positive", "neutral", "negative"])
    .optional()
    .describe("Filter sessions by overall sentiment. OMIT unless the user asks for one."),
  themeName: z
    .string()
    .optional()
    .describe(
      "Filter to sessions that contain at least one signal tagged with this theme (case-insensitive)."
    ),
  chunkTypes: z
    .array(chunkTypeEnum)
    .optional()
    .describe(
      "Filter to sessions that contain at least one chunk of the given types. OMIT unless the user asks for a specific chunk category."
    ),
  severity: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe(
      "Filter to sessions that contain at least one signal with this severity. OMIT unless the user asks."
    ),
  urgency: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe(
      "Filter to sessions that contain at least one signal with this urgency. OMIT unless the user asks."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max sessions to return (default 50)."),
});

export function createListSessionsTool(ctx: ChatToolContext) {
  return tool({
    description:
      "List sessions in the current workspace with lightweight metadata only (id, client name, date, sentiment, urgency, theme names) — no content. " +
      "Use this to discover which sessions exist and to get session ids for chaining into fetch_session_content or summarise_sessions. " +
      "Filter combinations are AND across the filter set: severity=high AND theme=pricing means sessions that contain at least one high-severity chunk AND at least one pricing-themed chunk (possibly different chunks).",
    inputSchema,
    execute: async (input) => {
      const sanitised = sanitiseListSessions(input, ctx.lastUserMessage, ctx.resolvedNames);
      ctx.emitStatus("Listing sessions…");
      const result = await listSessions(sanitised, {
        chatQueryRepo: ctx.chatQueryRepo,
      });
      return result;
    },
  });
}
