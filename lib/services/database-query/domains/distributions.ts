// ---------------------------------------------------------------------------
// Database Query — Distributions Domain
// ---------------------------------------------------------------------------
// Aggregations over `structured_json` fields. Sentiment and urgency produce
// bucketed maps; competitive_mention_frequency tallies competitor names from
// the competitiveMentions array.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { LOG_PREFIX } from "../action-metadata";
import { baseSessionQuery } from "../shared/base-query-builder";
import { aggregateJsonField } from "../shared/row-helpers";
import { filterRowsBySeverity } from "../shared/severity-filter";
import type { QueryFilters } from "../types";

export async function handleSentimentDistribution(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("structured_json")
      .not("structured_json", "is", null),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} sentiment_distribution error:`, error);
    throw new Error("Failed to fetch sentiment distribution");
  }

  const rows = filterRowsBySeverity(data ?? [], filters.severity);

  return aggregateJsonField(rows, "sentiment", {
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
  });
}

export async function handleUrgencyDistribution(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("structured_json")
      .not("structured_json", "is", null),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} urgency_distribution error:`, error);
    throw new Error("Failed to fetch urgency distribution");
  }

  const rows = filterRowsBySeverity(data ?? [], filters.severity);

  return aggregateJsonField(rows, "urgency", {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  });
}

export async function handleCompetitiveMentionFrequency(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("structured_json")
      .not("structured_json", "is", null),
    filters
  );

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} competitive_mention_frequency error:`, error);
    throw new Error("Failed to fetch competitive mentions");
  }

  const countMap = new Map<string, number>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const json = row.structured_json as Record<string, unknown> | null;
    const mentions = json?.competitiveMentions as
      | Array<{ competitor?: string }>
      | undefined;
    if (mentions) {
      for (const mention of mentions) {
        const name = mention.competitor;
        if (name) {
          countMap.set(name, (countMap.get(name) ?? 0) + 1);
        }
      }
    }
  }

  const competitors = Array.from(countMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { competitors };
}
