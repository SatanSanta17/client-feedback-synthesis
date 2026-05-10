// ---------------------------------------------------------------------------
// Insights Service — backs insights_latest / insights_history tools.
// PRD-033 P1.R4 / TRD § 1.3. Thin passthrough to the existing insights
// domain module via executeQuery.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

import { executeQuery } from "@/lib/services/database-query";

const LOG_PREFIX = "[insights-service]";

export async function getLatestInsights(
  filters: { teamId: string | null; limit?: number },
  deps: { supabase: SupabaseClient }
): Promise<Record<string, unknown>> {
  console.log(`${LOG_PREFIX} getLatestInsights — teamId: ${filters.teamId}`);
  const result = await executeQuery(deps.supabase, "insights_latest", {
    teamId: filters.teamId,
  });
  return result.data;
}

export async function getInsightsHistory(
  filters: { teamId: string | null; cursor?: string; limit?: number },
  deps: { supabase: SupabaseClient }
): Promise<Record<string, unknown>> {
  console.log(`${LOG_PREFIX} getInsightsHistory — teamId: ${filters.teamId}`);
  const result = await executeQuery(deps.supabase, "insights_history", {
    teamId: filters.teamId,
  });
  return result.data;
}
