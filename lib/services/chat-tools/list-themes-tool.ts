import { tool } from "ai";
import { z } from "zod";

import { listThemes } from "@/lib/services/chat-tool-services/discovery-service";

import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  nameSearch: z
    .string()
    .optional()
    .describe(
      "Substring match on theme name, case-insensitive. OMIT unless the user names a search term."
    ),
  dateFrom: z
    .string()
    .optional()
    .describe(
      "Start date (ISO YYYY-MM-DD) — only count theme mentions from sessions on/after this date."
    ),
  dateTo: z
    .string()
    .optional()
    .describe(
      "End date (ISO YYYY-MM-DD) — only count theme mentions from sessions on/before this date."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max themes to return (default 50, sorted by mention count desc)."),
});

export function createListThemesTool(ctx: ChatToolContext) {
  return tool({
    description:
      "List themes in the current workspace with mention counts, sorted by count desc. " +
      "Use this to discover what themes exist and to find the most-discussed topics. " +
      "Date filters narrow the mention-count window without affecting which themes are returned.",
    inputSchema,
    execute: async (input) => {
      ctx.emitStatus("Listing themes…");
      const result = await listThemes(input, {
        chatQueryRepo: ctx.chatQueryRepo,
      });
      return result;
    },
  });
}
