// ---------------------------------------------------------------------------
// Session Content Service — backs fetch_session_content tool.
// PRD-033 P1.R2 / TRD § 1.3.
//
// Returns "everything" for the requested sessions: all 11 chunk types plus
// session-level metadata. Token-budget enforcement caps how many sessions
// fit in one call. Budget is approximate (chars/4 proxy, ±20%).
// ---------------------------------------------------------------------------

import type { ChatQueryRepository } from "@/lib/repositories/chat-query-repository";
import type {
  EmbeddingRepository,
  SessionChunkRow,
} from "@/lib/repositories/embedding-repository";
import { estimateTokens } from "@/lib/services/token-estimator";

const LOG_PREFIX = "[session-content-service]";
const DEFAULT_BUDGET = parseInt(
  process.env.CHAT_FETCH_CONTENT_BUDGET ?? "50000",
  10
);

export interface SessionContentChunk {
  type: string;
  text: string;
  severity?: string;
  urgency?: string;
}

export interface SessionContent {
  sessionId: string;
  clientName: string;
  sessionDate: string;
  sentiment: string | null;
  urgency: string | null;
  themes: string[];
  rawNotes: string | null;
  chunks: SessionContentChunk[];
}

export interface FetchSessionContentResult {
  sessions: SessionContent[];
  fetched: number;
  requested: number;
  budgetReached: boolean;
}

export async function fetchSessionContent(
  ids: string[],
  deps: {
    chatQueryRepo: ChatQueryRepository;
    embeddingRepo: EmbeddingRepository;
    workspace: { teamId: string | null; userId: string };
  },
  budgetTokens: number = DEFAULT_BUDGET
): Promise<FetchSessionContentResult> {
  if (ids.length === 0) {
    return { sessions: [], fetched: 0, requested: 0, budgetReached: false };
  }

  console.log(
    `${LOG_PREFIX} fetchSessionContent — requested ${ids.length}, budget ${budgetTokens}`
  );

  const headers = await deps.chatQueryRepo.fetchSessionHeaders(ids);
  const headersBySessionId = new Map(headers.map((h) => [h.sessionId, h]));

  const allChunks = await deps.embeddingRepo.fetchBySessionIds(ids, {
    teamId: deps.workspace.teamId,
    userId: deps.workspace.userId,
  });
  const chunksBySessionId = groupChunks(allChunks);

  // Iterate in the order the model requested; budget-cut at the first session
  // that would push us over.
  const out: SessionContent[] = [];
  let used = 0;
  let budgetReached = false;

  for (const id of ids) {
    const header = headersBySessionId.get(id);
    if (!header) continue; // session not in workspace or deleted

    const chunkRows = chunksBySessionId.get(id) ?? [];
    const session: SessionContent = {
      sessionId: header.sessionId,
      clientName: header.clientName,
      sessionDate: header.sessionDate,
      sentiment: header.sentiment,
      urgency: header.urgency,
      themes: header.themes,
      rawNotes: header.rawNotes,
      chunks: chunkRows.map((c) => {
        const meta = c.metadata ?? {};
        return {
          type: c.chunkType,
          text: c.chunkText,
          severity: typeof meta.severity === "string" ? meta.severity : undefined,
          urgency: typeof meta.urgency === "string" ? meta.urgency : undefined,
        };
      }),
    };

    const sessionTokens = estimateTokens(session);
    if (out.length > 0 && used + sessionTokens > budgetTokens) {
      budgetReached = true;
      break;
    }
    out.push(session);
    used += sessionTokens;
  }

  console.log(
    `${LOG_PREFIX} fetchSessionContent — fetched ${out.length} / ${ids.length}, used ~${used} tokens, budgetReached: ${budgetReached}`
  );

  return {
    sessions: out,
    fetched: out.length,
    requested: ids.length,
    budgetReached,
  };
}

function groupChunks(chunks: SessionChunkRow[]): Map<string, SessionChunkRow[]> {
  const map = new Map<string, SessionChunkRow[]>();
  for (const chunk of chunks) {
    const list = map.get(chunk.sessionId) ?? [];
    list.push(chunk);
    map.set(chunk.sessionId, list);
  }
  return map;
}
