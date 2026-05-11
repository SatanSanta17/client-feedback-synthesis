import { tool } from "ai";
import { z } from "zod";

import { retrieveRelevantChunks } from "@/lib/services/retrieval-service";
import type { ChunkType } from "@/lib/types/embedding-chunk";

import { chunkTypeEnum } from "./shared/chunk-type-enum";
import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Semantic search query. Hybrid retrieval (vector + keyword via RRF) is used internally — exact terms (product names, jargon) and paraphrased phrasings are both supported. For broad/ambiguous questions, consider issuing 2-3 calls with rephrased queries and synthesising across the union."
    ),
  clientName: z
    .string()
    .optional()
    .describe(
      "Filter by exact client name (case-insensitive). OMIT unless the user names a specific client."
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
  chunkTypes: z
    .array(chunkTypeEnum)
    .optional()
    .describe(
      "Filter by chunk type. OMIT unless the user explicitly asks for a specific category."
    ),
});

export function createSemanticSearchTool(ctx: ChatToolContext) {
  return tool({
    description:
      "Search session content for qualitative insights matching a query. Returns ranked chunks with client name, session date, chunk type, text, and a relevance score. " +
      "Use this for similarity questions ('what are clients saying about onboarding?'). " +
      "Do NOT use for completeness questions ('list every pain point about pricing') — use fetch_signals for those.",
    inputSchema,
    execute: async (input) => {
      ctx.emitStatus("Searching across sessions…");
      const results = await retrieveRelevantChunks(
        input.query,
        {
          teamId: ctx.workspace.teamId,
          clientName: input.clientName,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          chunkTypes: input.chunkTypes as ChunkType[] | undefined,
        },
        ctx.embeddingRepo
      );
      return results.map((r) => ({
        // sessionId is included for citation plumbing in the chat surface;
        // system prompt v2 instructs the model not to mention UUIDs in
        // its reply.
        sessionId: r.sessionId,
        clientName: r.clientName,
        sessionDate: r.sessionDate,
        chunkType: r.chunkType,
        text: r.chunkText,
        score: r.similarityScore,
      }));
    },
  });
}
