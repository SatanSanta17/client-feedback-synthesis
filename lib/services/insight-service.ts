/**
 * Insight Service (PRD-021 Part 5)
 *
 * Generates AI-powered headline insights from dashboard aggregates.
 * Exposes two functions:
 *   - generateHeadlineInsights() — runs the full generation pipeline
 *   - maybeRefreshDashboardInsights() — conditional generation (only if new data exists)
 */

import { type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

import { callModelObject } from "@/lib/services/ai-service";
import { executeQuery } from "@/lib/services/database-query-service";
import type { InsightRepository, InsightInsert } from "@/lib/repositories/insight-repository";
import type { DashboardInsight } from "@/lib/types/insight";
import {
  HEADLINE_INSIGHTS_SYSTEM_PROMPT,
  HEADLINE_INSIGHTS_MAX_TOKENS,
  buildHeadlineInsightsUserMessage,
  type InsightAggregates,
} from "@/lib/prompts/headline-insights";
import {
  headlineInsightsResponseSchema,
  type HeadlineInsightsResponse,
} from "@/lib/schemas/headline-insights-schema";
import { scopeByTeam } from "@/lib/repositories/supabase/scope-by-team";

const LOG_PREFIX = "[insight-service]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerateInsightsParams {
  teamId: string | null;
  userId: string;
  insightRepo: InsightRepository;
  supabase: SupabaseClient;
}

// ---------------------------------------------------------------------------
// Aggregate fetching
// ---------------------------------------------------------------------------

/**
 * Fetches the 5 aggregate data sets from the dashboard query service and
 * maps them into the InsightAggregates shape expected by the prompt builder.
 */
async function fetchAggregates(
  supabase: SupabaseClient,
  teamId: string | null
): Promise<InsightAggregates> {
  console.log(`${LOG_PREFIX} fetchAggregates — teamId: ${teamId ?? "personal"}`);

  const filters = { teamId };

  const [
    sessionCountResult,
    sentimentResult,
    urgencyResult,
    topThemesResult,
    competitiveResult,
  ] = await Promise.all([
    executeQuery(supabase, "count_sessions", filters),
    executeQuery(supabase, "sentiment_distribution", filters),
    executeQuery(supabase, "urgency_distribution", filters),
    executeQuery(supabase, "top_themes", filters),
    executeQuery(supabase, "competitive_mention_frequency", filters),
  ]);

  // Map count_sessions → number
  const sessionCount = (sessionCountResult.data as { count: number }).count;

  // Map sentiment_distribution → Record<string, number>
  // The handler returns { positive, negative, neutral, mixed }
  const sentimentDistribution = sentimentResult.data as Record<string, number>;

  // Map urgency_distribution → Record<string, number>
  // The handler returns { low, medium, high }
  const urgencyDistribution = urgencyResult.data as Record<string, number>;

  // Map top_themes → array of { name, signalCount }
  const themesRaw = (topThemesResult.data as { themes: Array<{ themeName: string; count: number }> }).themes ?? [];
  const topThemes = themesRaw
    .slice(0, 10)
    .map((t) => ({ name: t.themeName, signalCount: t.count }));

  // Map competitive_mention_frequency → array of { name, count }
  const competitiveMentions = (
    (competitiveResult.data as { competitors: Array<{ name: string; count: number }> }).competitors ?? []
  ).slice(0, 10);

  console.log(
    `${LOG_PREFIX} fetchAggregates — sessions: ${sessionCount}, themes: ${topThemes.length}, competitors: ${competitiveMentions.length}`
  );

  return {
    sessionCount,
    sentimentDistribution,
    urgencyDistribution,
    topThemes,
    competitiveMentions,
  };
}

// ---------------------------------------------------------------------------
// Public: generateHeadlineInsights
// ---------------------------------------------------------------------------

/**
 * Full insight generation pipeline:
 * 1. Fetch dashboard aggregates
 * 2. Fetch previous insight batch for comparison
 * 3. Build the prompt and call callModelObject()
 * 4. Insert the new batch into the database
 * 5. Return the new insights
 */
export async function generateHeadlineInsights(
  params: GenerateInsightsParams
): Promise<DashboardInsight[]> {
  const { teamId, userId, insightRepo, supabase } = params;

  console.log(
    `${LOG_PREFIX} generateHeadlineInsights — teamId: ${teamId ?? "personal"}, userId: ${userId}`
  );

  // 1. Fetch aggregates
  const aggregates = await fetchAggregates(supabase, teamId);

  // 2. Fetch previous batch for comparison
  const previousBatch = await insightRepo.getLatestBatch(teamId);

  // 3. Build prompt and call LLM
  const userMessage = buildHeadlineInsightsUserMessage(aggregates, previousBatch);

  console.log(
    `${LOG_PREFIX} generateHeadlineInsights — calling callModelObject, previousBatch: ${previousBatch ? previousBatch.batchId : "none"}`
  );

  const llmResponse: HeadlineInsightsResponse = await callModelObject({
    systemPrompt: HEADLINE_INSIGHTS_SYSTEM_PROMPT,
    userMessage,
    schema: headlineInsightsResponseSchema,
    schemaName: "HeadlineInsightsResponse",
    maxTokens: HEADLINE_INSIGHTS_MAX_TOKENS,
    operationName: "generateHeadlineInsights",
  });

  console.log(
    `${LOG_PREFIX} generateHeadlineInsights — LLM returned ${llmResponse.insights.length} insights`
  );

  // 4. Insert batch
  const batchId = randomUUID();
  const now = new Date().toISOString();

  const inserts: InsightInsert[] = llmResponse.insights.map((item) => ({
    content: item.content,
    insight_type: item.insightType,
    batch_id: batchId,
    team_id: teamId,
    created_by: userId,
    generated_at: now,
  }));

  const inserted = await insightRepo.insertBatch(inserts);

  console.log(
    `${LOG_PREFIX} generateHeadlineInsights — inserted ${inserted.length} insights, batchId: ${batchId}`
  );

  // 5. Return
  return inserted;
}

// ---------------------------------------------------------------------------
// Public: maybeRefreshDashboardInsights
// ---------------------------------------------------------------------------

/**
 * Conditional insight refresh — generates new insights only if:
 * - No insights exist yet (first time), OR
 * - New sessions have been created since the last generation.
 *
 * Designed to be called in a fire-and-forget chain after session extraction.
 * Errors are logged but never thrown (caller should catch anyway).
 */
export async function maybeRefreshDashboardInsights(
  params: GenerateInsightsParams
): Promise<void> {
  const { teamId, userId, insightRepo, supabase } = params;

  try {
    console.log(
      `${LOG_PREFIX} maybeRefreshDashboardInsights — teamId: ${teamId ?? "personal"}`
    );

    // 1. Check when insights were last generated
    const lastGeneratedAt = await insightRepo.getLastGeneratedAt(teamId);

    if (!lastGeneratedAt) {
      // First time — generate
      console.log(`${LOG_PREFIX} maybeRefreshDashboardInsights — no previous insights, generating`);
      await generateHeadlineInsights(params);
      return;
    }

    // 2. Check if any sessions were created after the last generation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder
    let query: any = supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gt("created_at", lastGeneratedAt);

    query = scopeByTeam(query, teamId);

    const { count, error } = await query;

    if (error) {
      console.error(
        `${LOG_PREFIX} maybeRefreshDashboardInsights — error checking staleness:`,
        error.message
      );
      return;
    }

    if ((count ?? 0) > 0) {
      console.log(
        `${LOG_PREFIX} maybeRefreshDashboardInsights — ${count} new sessions since ${lastGeneratedAt}, generating`
      );
      await generateHeadlineInsights(params);
    } else {
      console.log(
        `${LOG_PREFIX} maybeRefreshDashboardInsights — no new sessions since ${lastGeneratedAt}, skipping`
      );
    }
  } catch (err) {
    console.error(
      `${LOG_PREFIX} maybeRefreshDashboardInsights — unhandled error:`,
      err instanceof Error ? err.message : err
    );
    // Swallow — fire-and-forget
  }
}
