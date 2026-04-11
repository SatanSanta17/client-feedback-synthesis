import { type SupabaseClient } from "@supabase/supabase-js";

import type { DashboardInsight, InsightBatch } from "@/lib/types/insight";
import type {
  InsightRepository,
  InsightInsert,
} from "../insight-repository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[supabase-insight-repo]";
const TABLE = "dashboard_insights";

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface InsightRow {
  id: string;
  content: string;
  insight_type: string;
  batch_id: string;
  team_id: string | null;
  created_by: string;
  generated_at: string;
}

function mapRow(row: InsightRow): DashboardInsight {
  return {
    id: row.id,
    content: row.content,
    insightType: row.insight_type as DashboardInsight["insightType"],
    batchId: row.batch_id,
    teamId: row.team_id,
    createdBy: row.created_by,
    generatedAt: row.generated_at,
  };
}

/**
 * Group flat rows into InsightBatch objects, preserving order.
 * Assumes rows are ordered by generated_at DESC.
 */
function groupIntoBatches(rows: InsightRow[]): InsightBatch[] {
  const map = new Map<string, InsightBatch>();
  const order: string[] = [];

  for (const row of rows) {
    let batch = map.get(row.batch_id);
    if (!batch) {
      batch = {
        batchId: row.batch_id,
        generatedAt: row.generated_at,
        insights: [],
      };
      map.set(row.batch_id, batch);
      order.push(row.batch_id);
    }
    batch.insights.push(mapRow(row));
  }

  return order.map((id) => map.get(id)!);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory for creating a Supabase-backed InsightRepository.
 *
 * Uses the service-role client for write operations (insight generation
 * runs in a server-side context after aggregation).
 */
export function createInsightRepository(
  serviceClient: SupabaseClient
): InsightRepository {
  return {
    // -----------------------------------------------------------------
    // getLatestBatch
    // -----------------------------------------------------------------
    async getLatestBatch(teamId: string | null): Promise<InsightBatch | null> {
      console.log(`${LOG_PREFIX} getLatestBatch — teamId: ${teamId}`);

      // Step 1: find the most recent batch_id
      const latestQuery = teamId
        ? serviceClient
            .from(TABLE)
            .select("batch_id, generated_at")
            .eq("team_id", teamId)
            .order("generated_at", { ascending: false })
            .limit(1)
        : serviceClient
            .from(TABLE)
            .select("batch_id, generated_at")
            .is("team_id", null)
            .order("generated_at", { ascending: false })
            .limit(1);

      const { data: latestRow, error: latestErr } = await latestQuery;

      if (latestErr) {
        console.error(
          `${LOG_PREFIX} getLatestBatch — error finding latest:`,
          latestErr.message
        );
        throw new Error(
          `Failed to find latest insight batch: ${latestErr.message}`
        );
      }

      if (!latestRow || latestRow.length === 0) {
        console.log(`${LOG_PREFIX} getLatestBatch — no insights found`);
        return null;
      }

      const batchId = (latestRow[0] as unknown as InsightRow).batch_id;

      // Step 2: fetch all rows for that batch
      const batchQuery = teamId
        ? serviceClient
            .from(TABLE)
            .select("*")
            .eq("team_id", teamId)
            .eq("batch_id", batchId)
            .order("generated_at", { ascending: false })
        : serviceClient
            .from(TABLE)
            .select("*")
            .is("team_id", null)
            .eq("batch_id", batchId)
            .order("generated_at", { ascending: false });

      const { data, error } = await batchQuery;

      if (error) {
        console.error(
          `${LOG_PREFIX} getLatestBatch — error fetching batch:`,
          error.message
        );
        throw new Error(
          `Failed to fetch latest insight batch: ${error.message}`
        );
      }

      const rows = (data ?? []) as unknown as InsightRow[];

      console.log(
        `${LOG_PREFIX} getLatestBatch — returning ${rows.length} insights`
      );

      return {
        batchId,
        generatedAt: rows[0]?.generated_at ?? "",
        insights: rows.map(mapRow),
      };
    },

    // -----------------------------------------------------------------
    // getPreviousBatches
    // -----------------------------------------------------------------
    async getPreviousBatches(
      teamId: string | null,
      limit: number
    ): Promise<InsightBatch[]> {
      console.log(
        `${LOG_PREFIX} getPreviousBatches — teamId: ${teamId}, limit: ${limit}`
      );

      // Fetch all rows ordered by generated_at DESC, then group in JS
      // skipping the first batch (latest).
      const query = teamId
        ? serviceClient
            .from(TABLE)
            .select("*")
            .eq("team_id", teamId)
            .order("generated_at", { ascending: false })
        : serviceClient
            .from(TABLE)
            .select("*")
            .is("team_id", null)
            .order("generated_at", { ascending: false });

      const { data, error } = await query;

      if (error) {
        console.error(
          `${LOG_PREFIX} getPreviousBatches — error:`,
          error.message
        );
        throw new Error(
          `Failed to fetch previous insight batches: ${error.message}`
        );
      }

      const rows = (data ?? []) as unknown as InsightRow[];
      const batches = groupIntoBatches(rows);

      // Skip the latest batch and take up to `limit`
      const previous = batches.slice(1, 1 + limit);

      console.log(
        `${LOG_PREFIX} getPreviousBatches — returning ${previous.length} batches`
      );

      return previous;
    },

    // -----------------------------------------------------------------
    // insertBatch
    // -----------------------------------------------------------------
    async insertBatch(insights: InsightInsert[]): Promise<DashboardInsight[]> {
      if (insights.length === 0) {
        return [];
      }

      console.log(
        `${LOG_PREFIX} insertBatch — ${insights.length} insights, batchId: ${insights[0].batch_id}`
      );

      const { data, error } = await serviceClient
        .from(TABLE)
        .insert(insights)
        .select("*");

      if (error) {
        console.error(
          `${LOG_PREFIX} insertBatch — error:`,
          error.message
        );
        throw new Error(
          `Failed to insert insight batch: ${error.message}`
        );
      }

      const rows = (data ?? []) as unknown as InsightRow[];

      console.log(
        `${LOG_PREFIX} insertBatch — success, ${rows.length} insights inserted`
      );

      return rows.map(mapRow);
    },

    // -----------------------------------------------------------------
    // getLastGeneratedAt
    // -----------------------------------------------------------------
    async getLastGeneratedAt(
      teamId: string | null
    ): Promise<string | null> {
      console.log(`${LOG_PREFIX} getLastGeneratedAt — teamId: ${teamId}`);

      const query = teamId
        ? serviceClient
            .from(TABLE)
            .select("generated_at")
            .eq("team_id", teamId)
            .order("generated_at", { ascending: false })
            .limit(1)
        : serviceClient
            .from(TABLE)
            .select("generated_at")
            .is("team_id", null)
            .order("generated_at", { ascending: false })
            .limit(1);

      const { data, error } = await query;

      if (error) {
        console.error(
          `${LOG_PREFIX} getLastGeneratedAt — error:`,
          error.message
        );
        throw new Error(
          `Failed to fetch last generated_at: ${error.message}`
        );
      }

      if (!data || data.length === 0) {
        console.log(`${LOG_PREFIX} getLastGeneratedAt — no insights found`);
        return null;
      }

      const result = (data[0] as unknown as InsightRow).generated_at;
      console.log(`${LOG_PREFIX} getLastGeneratedAt — ${result}`);
      return result;
    },
  };
}
