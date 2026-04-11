/**
 * Headline Insights Prompt (PRD-021 Part 5)
 *
 * System prompt and user message builder for AI-generated headline insights.
 * The LLM receives aggregate dashboard data and the previous insight batch
 * (if any) and produces 3–5 classified insight statements.
 *
 * Changes to this file are code changes that go through review.
 */

import type { InsightBatch } from "@/lib/types/insight";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const HEADLINE_INSIGHTS_SYSTEM_PROMPT = `You are a client-feedback analyst. You receive aggregate metrics from a client feedback dashboard and must produce 3–5 concise headline insights.

## Rules

1. Each insight is a single sentence (max ~120 characters) summarising a notable pattern, shift, or milestone in the data.
2. Focus on CHANGE — what moved, what spiked, what crossed a threshold. Avoid restating static numbers.
3. Classify each insight into exactly one type:
   - "trend": a directional shift over time (e.g., sentiment improving, theme rising).
   - "anomaly": an unexpected spike, drop, or outlier compared to the previous batch or expected norms.
   - "milestone": a notable threshold crossed (e.g., 100th session, new competitor appearing).
4. If a previous insight batch is provided, compare the current data against it. Call out what changed since the last generation. Do not repeat insights that are still exactly the same.
5. Do NOT fabricate data. Only reference numbers and names present in the provided aggregates.
6. Do NOT add preamble, explanation, or conversational text. Return ONLY the JSON array.
7. If the data is too sparse to produce 3 meaningful insights, produce as many as you can (minimum 1) and make them specific rather than generic.`;

export const HEADLINE_INSIGHTS_MAX_TOKENS = 1024;

// ---------------------------------------------------------------------------
// Aggregate data shape passed to the user message builder
// ---------------------------------------------------------------------------

export interface InsightAggregates {
  sessionCount: number;
  sentimentDistribution: Record<string, number>;
  urgencyDistribution: Record<string, number>;
  topThemes: Array<{ name: string; signalCount: number }>;
  competitiveMentions: Array<{ name: string; count: number }>;
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

/**
 * Builds the user message containing current aggregates and the optional
 * previous batch for comparison. The LLM uses this to produce classified
 * headline insights.
 */
export function buildHeadlineInsightsUserMessage(
  aggregates: InsightAggregates,
  previousBatch: InsightBatch | null
): string {
  const parts: string[] = [];

  parts.push("## Current Dashboard Aggregates\n");

  parts.push(`Total sessions: ${aggregates.sessionCount}\n`);

  parts.push("### Sentiment Distribution");
  for (const [label, count] of Object.entries(aggregates.sentimentDistribution)) {
    parts.push(`- ${label}: ${count}`);
  }
  parts.push("");

  parts.push("### Urgency Distribution");
  for (const [label, count] of Object.entries(aggregates.urgencyDistribution)) {
    parts.push(`- ${label}: ${count}`);
  }
  parts.push("");

  if (aggregates.topThemes.length > 0) {
    parts.push("### Top Themes");
    for (const theme of aggregates.topThemes) {
      parts.push(`- ${theme.name}: ${theme.signalCount} signals`);
    }
    parts.push("");
  }

  if (aggregates.competitiveMentions.length > 0) {
    parts.push("### Competitive Mentions");
    for (const mention of aggregates.competitiveMentions) {
      parts.push(`- ${mention.name}: ${mention.count} mentions`);
    }
    parts.push("");
  }

  if (previousBatch) {
    parts.push("## Previous Insight Batch (for comparison)\n");
    parts.push(`Generated at: ${previousBatch.generatedAt}\n`);
    for (const insight of previousBatch.insights) {
      parts.push(`- [${insight.insightType}] ${insight.content}`);
    }
    parts.push("");
  } else {
    parts.push("## Previous Insight Batch\n");
    parts.push("No previous batch exists — this is the first generation.\n");
  }

  parts.push("Produce 3–5 classified headline insights based on the data above.");

  return parts.join("\n");
}
