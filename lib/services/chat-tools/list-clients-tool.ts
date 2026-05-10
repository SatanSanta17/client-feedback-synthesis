import { tool } from "ai";
import { z } from "zod";

import { listClients } from "@/lib/services/chat-tool-services/discovery-service";

import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  nameSearch: z
    .string()
    .optional()
    .describe(
      "Substring match on client name, case-insensitive. OMIT unless the user names a search term — do not pass an empty string."
    ),
  hasSessions: z
    .boolean()
    .optional()
    .describe(
      "If true, return only clients with at least one non-deleted session in this workspace. Default false."
    ),
});

export function createListClientsTool(ctx: ChatToolContext) {
  return tool({
    description:
      "List clients in the current workspace with lightweight metadata (name, session count, last-session timestamp). " +
      "Use this to answer 'which clients exist?' or as the first step before fetching client-specific content. " +
      "Does NOT return session content; use fetch_session_content for that.",
    inputSchema,
    execute: async (input) => {
      ctx.emitStatus("Looking up clients…");
      const result = await listClients(input, {
        chatQueryRepo: ctx.chatQueryRepo,
      });
      return result;
    },
  });
}
