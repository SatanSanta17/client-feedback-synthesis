/**
 * Eval runner for PRD-033 (Agentic Chat — Primitive Tool Surface).
 * Usage: npm run eval:chat -- --surface=old|new [--query=Q-001]
 *
 * Reads docs/033-agentic-chat/eval/queries.json, invokes the chat surface for
 * each query (capturing the assistant's final text + tool-call sequence),
 * scores answer correctness via LLM-as-judge, computes tool-routing accuracy
 * via subsequence matching, and writes a per-query report to
 * docs/033-agentic-chat/eval/reports/<ISO>-<surface>.json.
 *
 * The actual surface invocation is deferred to a small adapter that the
 * implementer wires once the test environment (auth, supabase, AI keys) is
 * configured. This script focuses on the eval mechanics so it can be run
 * locally as soon as the integration shim is filled in.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { generateObject } from "ai";
import { z } from "zod";

import { resolveModel } from "@/lib/services/ai-service";
import { JUDGE_SYSTEM_PROMPT, JUDGE_PROMPT_VERSION } from "@/docs/033-agentic-chat/eval/judge-prompt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalQuery {
  id: string;
  category: "quantitative" | "qualitative" | "discovery" | "hybrid" | "exact-term";
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
  query: string;
  finalAnswer: string;
  expectedTrajectory: string[];
  actualTrajectory: string[];
  routingPass: boolean;
  judge: JudgeResult;
  durationMs: number;
}

interface AggregateReport {
  surface: "old" | "new";
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
  perQuery: QueryReport[];
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { surface: "old" | "new"; queryId?: string } {
  let surface: "old" | "new" | undefined;
  let queryId: string | undefined;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--surface=")) {
      const v = arg.slice("--surface=".length);
      if (v !== "old" && v !== "new") {
        throw new Error(`--surface must be 'old' or 'new', got: ${v}`);
      }
      surface = v;
    } else if (arg.startsWith("--query=")) {
      queryId = arg.slice("--query=".length);
    }
  }
  if (!surface) {
    throw new Error("--surface=old|new is required");
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
// Surface invocation adapter
// ---------------------------------------------------------------------------

/**
 * INTEGRATION SHIM — to be implemented when running the eval against a real
 * environment. The simplest path: spin up a mock conversation, post the query
 * via the existing /api/chat/send route (or a sibling fixture route), and
 * capture both the final assistant text and the sequence of tool names from
 * the SSE stream.
 *
 * For Part 1 we leave this as a stub that throws. The eval mechanics
 * (judge + scoring + report aggregation) compile and are exercised by tests
 * once the shim is filled in.
 */
async function invokeSurface(
  _surface: "old" | "new",
  _query: string
): Promise<SurfaceInvocationResult> {
  throw new Error(
    "Surface invocation shim not yet implemented. Wire this to /api/chat/send (or a fixture handler) and return { finalAnswer, toolCalls } from the SSE stream."
  );
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
    try {
      const r = await invokeSurface(surface, q.query);
      finalAnswer = r.finalAnswer;
      toolCalls = r.toolCalls;
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
      query: q.query,
      finalAnswer,
      expectedTrajectory: q.expectedTrajectory,
      actualTrajectory: toolCalls,
      routingPass,
      judge,
      durationMs: Date.now() - start,
    });

    console.log(
      `[eval] ${q.id} (${q.category}) — routing: ${routingPass ? "PASS" : "FAIL"}, judge.overall: ${judge.overall.toFixed(2)}`
    );
  }

  // Aggregate
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
  console.log(`[eval] Report: ${outPath}`);
}

main().catch((err) => {
  console.error("[eval] FATAL:", err);
  process.exit(1);
});
