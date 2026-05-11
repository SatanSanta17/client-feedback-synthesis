import { tool } from "ai";
import { z } from "zod";

import { listClients } from "@/lib/services/chat-tool-services/discovery-service";

import { sanitiseListClients } from "./shared/filter-sanitiser";
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
      const sanitised = sanitiseListClients(input, ctx.lastUserMessage);
      ctx.emitStatus("Looking up clients…");
      const result = await listClients(sanitised, {
        chatQueryRepo: ctx.chatQueryRepo,
      });
      // Record canonical names so later tool calls in the same turn can
      // pass them as filters without the sanitiser dropping them.
      for (const row of result) ctx.resolvedNames.clients.add(row.name);
      return result;
    },
  });
}
