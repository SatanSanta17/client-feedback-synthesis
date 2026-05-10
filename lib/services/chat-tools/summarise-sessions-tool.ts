import { tool } from "ai";
import { z } from "zod";

import { summariseSessions } from "@/lib/services/chat-tool-services/summarise-sessions-service";

import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  sessionIds: z
    .array(z.string().uuid())
    .min(1)
    .max(200)
    .describe(
      "List of session ids (UUIDs) to summarise. Get these from list_sessions. The fan-out cap (default 50) caps actual processing — the schema cap of 200 only prevents extreme inputs."
    ),
  focus: z
    .string()
    .optional()
    .describe(
      "Optional topic focus (e.g. 'pricing complaints', 'feature requests'). When set, each per-session summary is scoped to this topic; sessions with no matching content come back with the sentinel 'No content matches focus.'. OMIT for a balanced 3-sentence digest per session."
    ),
});

export function createSummariseSessionsTool(ctx: ChatToolContext) {
  return tool({
    description:
      "Summarise N sessions without holding all N in chat-model context. Fans out per-session summaries to a cheaper model, returns a digest array (sessionId, clientName, date, summary). " +
      "Use this for broad multi-session synthesis: 'summarise everything Acme said this quarter', 'what changed in our top theme between Q1 and Q2'. " +
      "Prefer this over fetch_session_content when N > ~10 — it's cheaper and avoids context bloat. " +
      "Capped at 50 sessions per call (default); pass paged ids for larger sets. " +
      "Sessions whose individual summary fails come back with summary=null + error — partial coverage is normal, mention it in your reply when it happens.",
    inputSchema,
    execute: async (input) => {
      ctx.emitStatus(`Summarising ${input.sessionIds.length} session(s)…`);
      const result = await summariseSessions(input, {
        chatQueryRepo: ctx.chatQueryRepo,
        embeddingRepo: ctx.embeddingRepo,
        workspace: ctx.workspace,
        onProgress: (done, total) => {
          // Throttle progress emits — every 10% or every 5 sessions,
          // whichever is smaller. Avoids hammering the SSE stream.
          const stride = Math.max(Math.ceil(total / 10), 5);
          if (done === total || done % stride === 0) {
            ctx.emitStatus(`Summarising sessions… (${done}/${total})`);
          }
        },
      });
      // Strip telemetry from the model-facing payload — the chat model gets
      // the digest array + every partial-coverage signal it needs to phrase
      // a partial-coverage message accurately. Telemetry is internal
      // observability only.
      return {
        summaries: result.summaries,
        summarised: result.summarised,
        requested: result.requested,
        capReached: result.capReached,
        budgetReached: result.budgetReached,
        outOfScopeCount: result.outOfScopeCount,
      };
    },
  });
}
