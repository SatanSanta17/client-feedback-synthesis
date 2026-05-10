import { tool } from "ai";
import { z } from "zod";

import { fetchSessionContent } from "@/lib/services/chat-tool-services/session-content-service";

import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  sessionIds: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .describe(
      "List of session ids (UUIDs) to fetch full content for. Get these from list_sessions. The token-budget cap is the real limit; the schema cap of 100 only prevents extreme inputs."
    ),
});

export function createFetchSessionContentTool(ctx: ChatToolContext) {
  return tool({
    description:
      "Fetch full content (all 11 chunk types + session metadata + raw notes) for a list of session ids. " +
      "Use this when the user wants details from specific sessions identified via list_sessions. " +
      "Capped by a token budget (~50k tokens of returned content); if the budget is exhausted before all ids are served, the response reports 'fetched N of M requested (token budget reached)' and the model should paginate or narrow. " +
      "For broad multi-session synthesis questions ('summarise everything Acme said this quarter'), prefer summarise_sessions when N > ~10 to avoid burning the chat context.",
    inputSchema,
    execute: async (input) => {
      ctx.emitStatus(`Fetching content for ${input.sessionIds.length} session(s)…`);
      const result = await fetchSessionContent(input.sessionIds, {
        chatQueryRepo: ctx.chatQueryRepo,
        embeddingRepo: ctx.embeddingRepo,
        workspace: ctx.workspace,
      });
      return result;
    },
  });
}
