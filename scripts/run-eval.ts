/**
 * Eval runner for PRD-033 (Agentic Chat — Primitive Tool Surface).
 *
 * Usage:
 *   npm run eval:chat                                # all queries
 *   npm run eval:chat -- --query=Q-001               # single query
 *   npm run eval:chat -- --surface=new               # explicit surface tag (default: new)
 *
 * Required env (loaded from .env.local via @next/env):
 *   EVAL_USER_ID         — the user_id to run the eval as (impersonation via service role)
 *   EVAL_TEAM_ID         — workspace to scope to (omit or set empty for personal workspace)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   AI_PROVIDER, AI_MODEL                            — chat model
 *   SUMMARY_AI_PROVIDER, SUMMARY_AI_MODEL            — cheap model for summarise_sessions
 *
 * PRD-033 Part 3 cutover retired the old two-tool surface. `--surface=old` is
 * no longer accepted (the code was deleted). The flag remains as a report tag.
 *
 * What the shim exercises (Path A — bypasses the HTTP route):
 *   - resolveModel + createChatTools(ctx) + budget tracker + filter sanitiser
 *   - same system prompt v2, same tools, same workspace scope as production
 *   - calls generateText (non-streaming) so we can pull final text + tool-call
 *     sequence directly from the SDK's StepResult array
 * What it skips:
 *   - Next.js request lifecycle, requireAuth() check, SSE encoding,
 *     conversation/message persistence. Not what the eval measures.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { generateObject, generateText, stepCountIs } from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { resolveModel } from "@/lib/services/ai-service";
import { clampOutputTokens } from "@/lib/services/ai-provider-limits";
import {
  CHAT_MAX_TOKENS,
  buildSystemPrompt,
} from "@/lib/prompts/chat-prompt";
import {
  CHAT_PER_TURN_BUDGET,
  createCostBudgetTracker,
} from "@/lib/services/chat-cost-budget";
import { createChatTools } from "@/lib/services/chat-tools";
import { createChatQueryRepository } from "@/lib/repositories/supabase/supabase-chat-query-repository";
import { createEmbeddingRepository } from "@/lib/repositories/supabase/supabase-embedding-repository";
import { JUDGE_SYSTEM_PROMPT, JUDGE_PROMPT_VERSION } from "@/docs/033-agentic-chat/eval/judge-prompt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalQuery {
  id: string;
  category: "quantitative" | "qualitative" | "discovery" | "hybrid" | "exact-term";
  /**
   * Optional flag bucketing the query under a PRD part. Queries without
   * this flag are treated as P1 baseline. PRD-033 P2.R9 requires Part-2
   * pass rate to be reported separately from baseline.
   */
  partOf?: "P1" | "P2";
  query: string;
  expectedTrajectory: string[];
  rubric: {
    mustMention?: string[];
    mustNotHallucinate?: string[];
  };
}

interface SurfaceInvocationResult {
  finalAnswer: string;
  toolCalls: string[];
  /**
   * Optional per-tool telemetry — for cost-test queries the shim should
   * surface the summarise_sessions telemetry block (input/output/total
   * tokens, duration, model label) so the Q-026 cost baseline lands in
   * the report.
   */
  toolTelemetry?: Record<string, unknown>;
}

interface JudgeResult {
  factual_correctness: number;
  groundedness: number;
  citation_accuracy: number;
  list_completeness: number;
  overall: number;
  justification: string;
}

interface QueryReport {
  id: string;
  category: string;
  partOf: "P1" | "P2";
  query: string;
  finalAnswer: string;
  expectedTrajectory: string[];
  actualTrajectory: string[];
  routingPass: boolean;
  judge: JudgeResult;
  durationMs: number;
  /**
   * Optional cost-test telemetry, populated by the surface invocation shim
   * for queries that exercise summarise_sessions or other cost-relevant
   * tools. Used by the Q-026 baseline cost report (PRD § P3.AC6 input).
   */
  toolTelemetry?: Record<string, unknown>;
}

interface AggregateReport {
  surface: "new";
  judgePromptVersion: string;
  judgeModel: string;
  generatedAt: string;
  totals: {
    queries: number;
    answerCorrectnessAvg: number;
    routingAccuracyPct: number;
  };
  byCategory: Record<
    string,
    { count: number; answerCorrectnessAvg: number; routingAccuracyPct: number }
  >;
  /**
   * Pass rate bucketed by PRD part. Queries without `partOf` fall under P1.
   * PRD-033 P2.R9: Part-2 pass rate is reported separately so the new
   * capability is evidence-tracked, not just claimed.
   */
  partOfBreakdown: Record<
    "P1" | "P2",
    { count: number; answerCorrectnessAvg: number; routingAccuracyPct: number }
  >;
  perQuery: QueryReport[];
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { surface: "new"; queryId?: string } {
  let surface: "new" = "new";
  let queryId: string | undefined;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--surface=")) {
      const v = arg.slice("--surface=".length);
      if (v === "old") {
        throw new Error(
          "--surface=old is no longer supported. The legacy two-tool surface (searchInsights + queryDatabase) was retired in PRD-033 Part 3 cutover (2026-05-11) and the code is deleted. Use --surface=new (the default) or omit the flag."
        );
      }
      if (v !== "new") {
        throw new Error(`--surface must be 'new' (or omit), got: ${v}`);
      }
      surface = v;
    } else if (arg.startsWith("--query=")) {
      queryId = arg.slice("--query=".length);
    }
  }
  return { surface, queryId };
}

// ---------------------------------------------------------------------------
// Subsequence matcher (PRD § P1.R9 — extras allowed, missing required calls fails)
// ---------------------------------------------------------------------------

function isSubsequence(expected: string[], actual: string[]): boolean {
  let i = 0;
  for (const a of actual) {
    if (a === expected[i]) i++;
    if (i === expected.length) return true;
  }
  return i === expected.length;
}

// ---------------------------------------------------------------------------
// Surface invocation adapter — Path A (bypass HTTP route)
// ---------------------------------------------------------------------------

function readEvalIdentity(): { userId: string; teamId: string | null } {
  const userId = process.env.EVAL_USER_ID;
  if (!userId) {
    throw new Error(
      "EVAL_USER_ID is required — set it in .env.local to the auth.users.id of the test account whose workspace the eval should run against."
    );
  }
  const rawTeam = process.env.EVAL_TEAM_ID?.trim();
  return {
    userId,
    teamId: rawTeam && rawTeam.length > 0 ? rawTeam : null,
  };
}

function buildServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local."
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface ToolCallRecord {
  toolName: string;
  output?: unknown;
}

/**
 * Path A — bypass the Next.js route entirely. Constructs the same
 * ChatToolContext + tool registry + system prompt v2 + budget tracker that
 * `chat-stream-service` uses, then calls `generateText` (non-streaming,
 * since the eval cares about the final answer + tool-call sequence, not
 * the stream itself). Returns the same shape the previous stub did.
 */
async function invokeSurface(
  _surface: "new",
  query: string
): Promise<SurfaceInvocationResult> {
  const { userId, teamId } = readEvalIdentity();
  const serviceClient = buildServiceClient();
  const { model, label: modelLabel } = resolveModel();

  const embeddingRepo = createEmbeddingRepository(
    serviceClient,
    teamId,
    userId
  );
  const chatQueryRepo = createChatQueryRepository(
    serviceClient,
    teamId,
    userId
  );

  const budgetTracker = createCostBudgetTracker(CHAT_PER_TURN_BUDGET);

  const baseTools = createChatTools({
    workspace: { teamId, userId },
    chatQueryRepo,
    embeddingRepo,
    supabaseClient: serviceClient,
    emitStatus: () => {
      // No-op for eval — the eval doesn't consume the SSE stream.
    },
    lastUserMessage: query,
    resolvedNames: {
      clients: new Set<string>(),
      themes: new Set<string>(),
    },
  });
  const tools = budgetTracker.wrap(baseTools);

  const systemPrompt = buildSystemPrompt({
    date: new Date().toISOString().split("T")[0],
  });

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: query }],
    tools,
    stopWhen: stepCountIs(10),
    maxOutputTokens: clampOutputTokens(CHAT_MAX_TOKENS, modelLabel),
  });

  // Pull the tool-call sequence in order from result.steps. Each step
  // corresponds to one model→tool→result round-trip in the agentic loop.
  const toolCalls: string[] = [];
  for (const step of result.steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      const rec = call as ToolCallRecord;
      toolCalls.push(rec.toolName);
    }
  }

  return {
    finalAnswer: result.text,
    toolCalls,
    toolTelemetry: {
      model: modelLabel,
      totalTokens: result.usage?.totalTokens,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      budgetExceeded: budgetTracker.isExceeded(),
      toolResultTokens: budgetTracker.total(),
      stepCount: result.steps?.length ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

const judgeSchema = z.object({
  factual_correctness: z.number().min(0).max(1),
  groundedness: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  list_completeness: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  justification: z.string(),
});

async function judgeAnswer(
  query: EvalQuery,
  finalAnswer: string
): Promise<{ judge: JudgeResult; modelLabel: string }> {
  const { model, label } = resolveModel();
  const userPrompt = JSON.stringify(
    {
      // Judge prompt v2 expects `today` so it can evaluate temporal
      // references (e.g. flag dates after today as "future treated as past").
      today: new Date().toISOString().split("T")[0],
      query: query.query,
      answer: finalAnswer,
      rubric: query.rubric,
    },
    null,
    2
  );

  const { object } = await generateObject({
    model,
    schema: judgeSchema,
    system: JUDGE_SYSTEM_PROMPT,
    prompt: userPrompt,
    maxOutputTokens: 600,
  });

  return { judge: object, modelLabel: label };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { surface, queryId } = parseArgs(process.argv);

  const queriesPath = path.resolve(
    process.cwd(),
    "docs/033-agentic-chat/eval/queries.json"
  );
  const raw = await fs.readFile(queriesPath, "utf8");
  const queries: EvalQuery[] = JSON.parse(raw);
  const filtered = queryId
    ? queries.filter((q) => q.id === queryId)
    : queries;

  if (filtered.length === 0) {
    throw new Error(`No queries matched ${queryId ?? "<all>"}`);
  }

  console.log(
    `[eval] Running ${filtered.length} queries against surface=${surface}`
  );

  const perQuery: QueryReport[] = [];
  let judgeModelLabel = "unknown";

  for (const q of filtered) {
    const start = Date.now();
    let finalAnswer = "";
    let toolCalls: string[] = [];
    let toolTelemetry: Record<string, unknown> | undefined;
    try {
      const r = await invokeSurface(surface, q.query);
      finalAnswer = r.finalAnswer;
      toolCalls = r.toolCalls;
      toolTelemetry = r.toolTelemetry;
    } catch (err) {
      console.error(
        `[eval] surface invocation failed for ${q.id}:`,
        err instanceof Error ? err.message : String(err)
      );
      finalAnswer = `[surface invocation error: ${err instanceof Error ? err.message : "unknown"}]`;
    }

    let judge: JudgeResult = {
      factual_correctness: 0,
      groundedness: 0,
      citation_accuracy: 0,
      list_completeness: 0,
      overall: 0,
      justification: "Surface invocation failed; skipping judge.",
    };
    if (finalAnswer && !finalAnswer.startsWith("[surface invocation error")) {
      try {
        const j = await judgeAnswer(q, finalAnswer);
        judge = j.judge;
        judgeModelLabel = j.modelLabel;
      } catch (err) {
        console.error(
          `[eval] judge failed for ${q.id}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    const routingPass = isSubsequence(q.expectedTrajectory, toolCalls);

    perQuery.push({
      id: q.id,
      category: q.category,
      partOf: q.partOf ?? "P1",
      query: q.query,
      finalAnswer,
      expectedTrajectory: q.expectedTrajectory,
      actualTrajectory: toolCalls,
      routingPass,
      judge,
      durationMs: Date.now() - start,
      toolTelemetry,
    });

    console.log(
      `[eval] ${q.id} (${q.category}) — routing: ${routingPass ? "PASS" : "FAIL"}, judge.overall: ${judge.overall.toFixed(2)}`
    );
  }

  // Aggregate by category
  const byCategory: AggregateReport["byCategory"] = {};
  for (const r of perQuery) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = {
        count: 0,
        answerCorrectnessAvg: 0,
        routingAccuracyPct: 0,
      };
    }
    const cat = byCategory[r.category];
    cat.answerCorrectnessAvg =
      (cat.answerCorrectnessAvg * cat.count + r.judge.overall) / (cat.count + 1);
    cat.routingAccuracyPct =
      ((cat.routingAccuracyPct / 100) * cat.count + (r.routingPass ? 1 : 0)) /
        (cat.count + 1) *
      100;
    cat.count += 1;
  }

  // Aggregate by PRD part — PRD § P2.R9 requires Part-2 pass rate to be
  // reported separately from the P1 baseline.
  const partOfBreakdown: AggregateReport["partOfBreakdown"] = {
    P1: { count: 0, answerCorrectnessAvg: 0, routingAccuracyPct: 0 },
    P2: { count: 0, answerCorrectnessAvg: 0, routingAccuracyPct: 0 },
  };
  for (const r of perQuery) {
    const bucket = partOfBreakdown[r.partOf];
    bucket.answerCorrectnessAvg =
      (bucket.answerCorrectnessAvg * bucket.count + r.judge.overall) /
      (bucket.count + 1);
    bucket.routingAccuracyPct =
      ((bucket.routingAccuracyPct / 100) * bucket.count +
        (r.routingPass ? 1 : 0)) /
        (bucket.count + 1) *
      100;
    bucket.count += 1;
  }

  const totalAvg =
    perQuery.reduce((sum, r) => sum + r.judge.overall, 0) /
    Math.max(perQuery.length, 1);
  const routingPct =
    (perQuery.filter((r) => r.routingPass).length / Math.max(perQuery.length, 1)) *
    100;

  const aggregate: AggregateReport = {
    surface,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    judgeModel: judgeModelLabel,
    generatedAt: new Date().toISOString(),
    totals: {
      queries: perQuery.length,
      answerCorrectnessAvg: totalAvg,
      routingAccuracyPct: routingPct,
    },
    byCategory,
    partOfBreakdown,
    perQuery,
  };

  const reportsDir = path.resolve(
    process.cwd(),
    "docs/033-agentic-chat/eval/reports"
  );
  await fs.mkdir(reportsDir, { recursive: true });
  const outPath = path.join(
    reportsDir,
    `${aggregate.generatedAt.replace(/[:.]/g, "-")}-${surface}.json`
  );
  await fs.writeFile(outPath, JSON.stringify(aggregate, null, 2));

  console.log(
    `\n[eval] DONE. Surface=${surface}, queries=${perQuery.length}, answerCorrectnessAvg=${totalAvg.toFixed(3)}, routingAccuracyPct=${routingPct.toFixed(1)}%`
  );
  console.log(
    `[eval] Part breakdown — P1: ${partOfBreakdown.P1.count} queries, judge=${partOfBreakdown.P1.answerCorrectnessAvg.toFixed(3)}, routing=${partOfBreakdown.P1.routingAccuracyPct.toFixed(1)}% | P2: ${partOfBreakdown.P2.count} queries, judge=${partOfBreakdown.P2.answerCorrectnessAvg.toFixed(3)}, routing=${partOfBreakdown.P2.routingAccuracyPct.toFixed(1)}%`
  );
  console.log(`[eval] Report: ${outPath}`);
}

main().catch((err) => {
  console.error("[eval] FATAL:", err);
  process.exit(1);
});
