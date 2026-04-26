// ---------------------------------------------------------------------------
// Database Query — Insights Domain
// ---------------------------------------------------------------------------
// AI-generated dashboard insight cards. `insights_latest` returns the most
// recent batch (two-step: find latest batch_id, fetch all rows for it).
// `insights_history` returns up to 10 prior batches grouped by batch_id.
//
// Team scoping flows through scopeByTeam directly — the dashboard_insights
// queries don't fit the baseSessionQuery / baseClientQuery wrappers (different
// table, different filter shape), but the scoping primitive is the same.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { scopeByTeam } from "@/lib/repositories/supabase/scope-by-team";

import { LOG_PREFIX } from "../action-metadata";
import type { QueryFilters } from "../types";

/**
 * Fetch the most recent batch of insights for the current workspace.
 * Two-step query: find the latest batch_id, then fetch all rows for it.
 */
export async function handleInsightsLatest(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // Step 1: find latest batch_id
  let latestQuery = supabase
    .from("dashboard_insights")
    .select("batch_id, generated_at")
    .order("generated_at", { ascending: false })
    .limit(1);
  latestQuery = scopeByTeam(latestQuery, filters.teamId);

  const { data: latestRow, error: latestErr } = await latestQuery;

  if (latestErr) {
    console.error(`${LOG_PREFIX} insights_latest — error finding latest:`, latestErr.message);
    throw new Error("Failed to find latest insight batch");
  }

  if (!latestRow || latestRow.length === 0) {
    return { batch: null };
  }

  const batchId = (latestRow[0] as unknown as { batch_id: string }).batch_id;
  const generatedAt = (latestRow[0] as unknown as { generated_at: string }).generated_at;

  // Step 2: fetch all rows for that batch
  let batchQuery = supabase
    .from("dashboard_insights")
    .select("*")
    .eq("batch_id", batchId);
  batchQuery = scopeByTeam(batchQuery, filters.teamId);

  const { data, error } = await batchQuery;

  if (error) {
    console.error(`${LOG_PREFIX} insights_latest — error fetching batch:`, error.message);
    throw new Error("Failed to fetch latest insight batch");
  }

  const insights = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    content: row.content,
    insightType: row.insight_type,
    batchId: row.batch_id,
    teamId: row.team_id,
    createdBy: row.created_by,
    generatedAt: row.generated_at,
  }));

  return {
    batch: {
      batchId,
      generatedAt,
      insights,
    },
  };
}

/**
 * Fetch previous insight batches (excluding the latest), grouped by batch_id.
 * Returns up to 10 batches ordered by generated_at DESC.
 */
export async function handleInsightsHistory(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  let query = supabase
    .from("dashboard_insights")
    .select("*")
    .order("generated_at", { ascending: false });
  query = scopeByTeam(query, filters.teamId);

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} insights_history — error:`, error.message);
    throw new Error("Failed to fetch insight history");
  }

  // Group rows by batch_id, preserving order
  const batchMap = new Map<string, { generatedAt: string; insights: Record<string, unknown>[] }>();
  const batchOrder: string[] = [];

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const bid = row.batch_id as string;
    let batch = batchMap.get(bid);
    if (!batch) {
      batch = {
        generatedAt: row.generated_at as string,
        insights: [],
      };
      batchMap.set(bid, batch);
      batchOrder.push(bid);
    }
    batch.insights.push({
      id: row.id,
      content: row.content,
      insightType: row.insight_type,
      batchId: row.batch_id,
      teamId: row.team_id,
      createdBy: row.created_by,
      generatedAt: row.generated_at,
    });
  }

  // Skip the latest batch, take up to 10
  const batches = batchOrder
    .slice(1, 11)
    .map((bid) => ({
      batchId: bid,
      generatedAt: batchMap.get(bid)!.generatedAt,
      insights: batchMap.get(bid)!.insights,
    }));

  return { batches };
}
