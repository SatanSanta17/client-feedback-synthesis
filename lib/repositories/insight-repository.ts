// ---------------------------------------------------------------------------
// Insight Repository Interface
// ---------------------------------------------------------------------------

import type { DashboardInsight, InsightBatch } from "@/lib/types/insight";

/** Shape of a single insight row to insert (snake_case for Supabase). */
export interface InsightInsert {
  content: string;
  insight_type: "trend" | "anomaly" | "milestone";
  batch_id: string;
  team_id: string | null;
  created_by: string;
  generated_at: string;
}

export interface InsightRepository {
  /** Fetch the most recent batch of insights for a workspace. */
  getLatestBatch(teamId: string | null): Promise<InsightBatch | null>;

  /**
   * Fetch previous batches (excluding the latest), ordered most-recent-first.
   * @param limit Maximum number of batches to return.
   */
  getPreviousBatches(
    teamId: string | null,
    limit: number
  ): Promise<InsightBatch[]>;

  /** Insert a batch of insights. */
  insertBatch(insights: InsightInsert[]): Promise<DashboardInsight[]>;

  /** Return the `generated_at` of the most recent insight, or null if none exist. */
  getLastGeneratedAt(teamId: string | null): Promise<string | null>;
}
