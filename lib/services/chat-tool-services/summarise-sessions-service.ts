// ---------------------------------------------------------------------------
// Summarise-Sessions Service — backs the summarise_sessions tool.
// PRD-033 Part 2 / TRD § 2.5.
//
// Map-reduce: this service is the MAP step. Each session is summarised
// independently by a cheaper model (`SUMMARY_AI_*` env vars); the array
// of digests is then returned to the chat model for the REDUCE step
// (synthesis). Per-row error isolation, bounded concurrency, no content
// retention, sanitised model-facing errors.
// ---------------------------------------------------------------------------

import { generateText } from "ai";

import type { ChatQueryRepository } from "@/lib/repositories/chat-query-repository";
import type { EmbeddingRepository } from "@/lib/repositories/embedding-repository";
import { runWithConcurrency } from "@/lib/services/bounded-concurrency";
import {
  resolveCheapModel,
  withCheapModelRetry,
} from "@/lib/services/cheap-model-service";
import {
  SUMMARISE_SESSION_MAX_OUTPUT_TOKENS_DEFAULT,
  SUMMARISE_SESSION_SYSTEM_PROMPT,
  renderSummariseSessionUser,
} from "@/lib/prompts/summarise-session-prompt";
import { estimateTokens } from "@/lib/services/token-estimator";

import { fetchSessionContent } from "./session-content-service";

const LOG_PREFIX = "[summarise-sessions-service]";

const FANOUT_CAP = parseInt(process.env.SUMMARY_AI_FANOUT_CAP ?? "50", 10);
const CONCURRENCY = parseInt(process.env.SUMMARY_AI_CONCURRENCY ?? "5", 10);
const MAX_OUTPUT = parseInt(
  process.env.SUMMARY_AI_MAX_OUTPUT_TOKENS ??
    String(SUMMARISE_SESSION_MAX_OUTPUT_TOKENS_DEFAULT),
  10
);

export interface SummariseInput {
  sessionIds: string[];
  focus?: string;
}

export interface SummaryRow {
  sessionId: string;
  clientName: string;
  date: string;
  summary: string | null;
  error?: string;
}

export interface SummariseResult {
  summaries: SummaryRow[];
  summarised: number;
  requested: number;
  /** True when more session ids were passed than this service's fan-out cap. */
  capReached: boolean;
  /**
   * True when the upstream fetchSessionContent token budget was exhausted
   * before all fan-out-cap-allowed ids could be loaded. Distinct from
   * capReached.
   */
  budgetReached: boolean;
  /**
   * Sessions the chat model asked about that weren't in the active workspace
   * (filtered by RLS / scope). Distinct from telemetry.failedCount, which
   * counts leaves that ran and failed.
   */
  outOfScopeCount: number;
  /** Aggregate cheap-model telemetry — not persisted, logged only. */
  telemetry: {
    cheapModelLabel: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    failedCount: number;
    durationMs: number;
  };
}

export async function summariseSessions(
  input: SummariseInput,
  deps: {
    chatQueryRepo: ChatQueryRepository;
    embeddingRepo: EmbeddingRepository;
    workspace: { teamId: string | null; userId: string };
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<SummariseResult> {
  const requested = input.sessionIds.length;
  const ids = input.sessionIds.slice(0, FANOUT_CAP);
  const capReached = requested > FANOUT_CAP;

  console.log(
    `${LOG_PREFIX} summariseSessions — requested: ${requested}, after fan-out cap: ${ids.length}, capReached: ${capReached}, focus: ${input.focus ?? "(none)"}`
  );

  // Fetch full content via Part 1's service. The cheap model receives this
  // payload one session at a time — content never crosses into the chat
  // model's context.
  const contentResult = await fetchSessionContent(ids, {
    chatQueryRepo: deps.chatQueryRepo,
    embeddingRepo: deps.embeddingRepo,
    workspace: deps.workspace,
  });

  const start = Date.now();
  const { model, label } = resolveCheapModel();

  // System prompt is sent on every leaf call — count it once × N for an
  // honest input-token total. Without this we'd under-count by ~300 tokens
  // per leaf (15k on a 50-session call).
  const systemTokens = estimateTokens(SUMMARISE_SESSION_SYSTEM_PROMPT);
  let inputTokens = systemTokens * contentResult.sessions.length;
  let outputTokens = 0;

  const tasks = contentResult.sessions.map((session) => async () => {
    const userMsg = renderSummariseSessionUser(session, input.focus);
    inputTokens += estimateTokens(userMsg);
    const { text, usage } = await withCheapModelRetry(
      `summarise-session ${session.sessionId}`,
      () =>
        generateText({
          model,
          system: SUMMARISE_SESSION_SYSTEM_PROMPT,
          prompt: userMsg,
          maxOutputTokens: MAX_OUTPUT,
        })
    );
    outputTokens += usage?.outputTokens ?? estimateTokens(text);
    return {
      sessionId: session.sessionId,
      clientName: session.clientName,
      date: session.sessionDate,
      summary: text.trim(),
    } satisfies SummaryRow;
  });

  const taskResults = await runWithConcurrency(
    tasks,
    CONCURRENCY,
    deps.onProgress
  );

  const summaries: SummaryRow[] = contentResult.sessions.map((session, i) => {
    const r = taskResults[i];
    if (r?.ok) return r.value;
    // Sanitise: log the raw error server-side, return a generic message to
    // the chat model. Provider-specific details (auth keys, internal URLs,
    // stack traces) must not surface to the LLM context.
    if (r && r.ok === false) {
      console.error(
        `${LOG_PREFIX} leaf failed — session ${session.sessionId}:`,
        r.error
      );
    }
    return {
      sessionId: session.sessionId,
      clientName: session.clientName,
      date: session.sessionDate,
      summary: null,
      error: "summary unavailable for this session",
    };
  });

  const failedCount = summaries.filter((s) => s.summary === null).length;

  // Sessions the chat model asked about that workspace scope filtered out
  // before processing (RLS / personal-workspace check). Sourced directly
  // from fetchSessionContent so we don't conflate "filtered by scope"
  // with "didn't fit under the token budget".
  const outOfScopeCount = contentResult.outOfScopeCount;

  const telemetry = {
    cheapModelLabel: label,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    failedCount,
    durationMs: Date.now() - start,
  };

  console.log(
    `${LOG_PREFIX} summariseSessions complete — summarised: ${summaries.length}, failed: ${failedCount}, outOfScope: ${outOfScopeCount}, capReached: ${capReached}, budgetReached: ${contentResult.budgetReached}, model: ${label}, tokens(in/out/total): ${telemetry.inputTokens}/${telemetry.outputTokens}/${telemetry.totalTokens}, duration: ${telemetry.durationMs}ms`
  );

  return {
    summaries,
    summarised: summaries.length,
    requested,
    capReached,
    budgetReached: contentResult.budgetReached,
    outOfScopeCount,
    telemetry,
  };
}
