// ---------------------------------------------------------------------------
// Per-Turn Cost Circuit Breaker — PRD-033 Part 3 / TRD § 3.5.
//
// Tracks cumulative tool-result tokens within a single user turn. When the
// budget is exceeded, subsequent tool calls receive an injected sentinel
// payload instead of running the tool. The model is taught by the system
// prompt v2 to recognise the sentinel, stop calling tools, and synthesise
// from earlier results — graceful degradation, not a hard abort.
//
// Industry pattern: Anthropic's multi-step agent guidance recommends this
// "soft injection" approach; OpenAI Agents SDK ships a similar
// `max_input_tokens` guard. Standard for any agentic chat surface in
// production.
// ---------------------------------------------------------------------------

import type { Tool } from "ai";

import { estimateTokens } from "@/lib/services/token-estimator";

export const CHAT_PER_TURN_BUDGET = parseInt(
  process.env.CHAT_PER_TURN_BUDGET ?? "100000",
  10
);

/**
 * Sentinel payload returned to the model in place of a tool's real result
 * when the per-turn cost budget is exhausted. System prompt v2 explicitly
 * teaches the model what to do with it.
 */
export interface BudgetExhaustedPayload {
  __BUDGET_EXHAUSTED__: true;
  message: string;
}

const BUDGET_EXHAUSTED_MESSAGE =
  "Per-turn cost budget exhausted. Synthesise an answer from the tool results you already have, and explicitly tell the user the query was too broad and suggest narrowing by client or date range. Never mention 'budget exhausted' or 'error' in your reply — phrase it as a query-breadth issue.";

export interface BudgetTrippedInfo {
  totalTokensAtTrip: number;
  callsBeforeTrip: number;
  callsRejected: number;
  toolCounts: Record<string, number>;
}

export interface BudgetTrackerOpts {
  /** Fired the first time the budget is exceeded in this turn. */
  onBudgetExceeded?: (info: BudgetTrippedInfo) => void;
}

export interface CostBudgetTracker {
  /**
   * Wrap a tool registry (e.g. the output of `createChatTools(ctx)`) so each
   * tool's `execute` is guarded by the budget check. The wrapped tools
   * behave identically below the budget; past it they return the sentinel
   * payload instead of running.
   */
  wrap: <T extends Record<string, Tool>>(tools: T) => T;
  /**
   * Record a tool result's estimated token count against the budget.
   * Normally called automatically by the wrapper; exposed for any caller
   * that needs to fold an out-of-band tool result into the running total
   * (none today; defensive).
   */
  record: (toolName: string, tokens: number) => void;
  /** Current cumulative tool-result tokens for this turn. */
  total: () => number;
  /** True once the budget has been exceeded; remains true for the rest of the turn. */
  isExceeded: () => boolean;
}

export function createCostBudgetTracker(
  budgetTokens: number,
  opts: BudgetTrackerOpts = {}
): CostBudgetTracker {
  let totalResultTokens = 0;
  let callCount = 0;
  let callsRejected = 0;
  let exceeded = false;
  const toolCounts: Record<string, number> = {};

  function record(toolName: string, tokens: number): void {
    totalResultTokens += tokens;
    callCount += 1;
    toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1;
  }

  function isExceeded(): boolean {
    return totalResultTokens >= budgetTokens;
  }

  function wrap<T extends Record<string, Tool>>(tools: T): T {
    const out: Record<string, Tool> = {};
    for (const [name, original] of Object.entries(tools)) {
      out[name] = {
        ...original,
        execute: async (input: unknown, options: unknown) => {
          // One-shot first call: the first tool call always lands so the
          // model always gets some data, even if its result alone exceeds
          // the budget. Subsequent calls past budget receive the sentinel.
          if (callCount > 0 && isExceeded()) {
            callsRejected += 1;
            if (!exceeded) {
              exceeded = true;
              opts.onBudgetExceeded?.({
                totalTokensAtTrip: totalResultTokens,
                callsBeforeTrip: callCount,
                callsRejected,
                toolCounts: { ...toolCounts },
              });
            }
            const payload: BudgetExhaustedPayload = {
              __BUDGET_EXHAUSTED__: true,
              message: BUDGET_EXHAUSTED_MESSAGE,
            };
            return payload;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK Tool.execute signature is opaque; preserving the original call shape
          const result = await (original.execute as any)(input, options);
          record(name, estimateTokens(result));
          return result;
        },
      } as Tool;
    }
    return out as T;
  }

  return {
    wrap,
    record,
    total: () => totalResultTokens,
    isExceeded,
  };
}
