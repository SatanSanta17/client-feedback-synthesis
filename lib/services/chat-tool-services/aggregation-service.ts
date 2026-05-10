// ---------------------------------------------------------------------------
// Aggregation Service — backs aggregate / time_series tools.
// PRD-033 P1.R3 / TRD § 1.3.
//
// Thin adapter over executeQuery (the existing database-query layer). Maps
// (entity, groupBy) tuples to the underlying QueryAction per the PRD's
// 13-action mapping table, then re-shapes the result for the chat model.
//
// The dashboard's executeQuery surface is unchanged.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

import { executeQuery } from "@/lib/services/database-query";
import type { QueryAction, QueryFilters } from "@/lib/services/database-query";

const LOG_PREFIX = "[aggregation-service]";

export type AggregateEntity = "sessions" | "signals" | "clients";
export type AggregateDim =
  | "client"
  | "theme"
  | "sentiment"
  | "urgency"
  | "severity"
  | "chunkType";

export interface AggregateInput {
  entity: AggregateEntity;
  groupBy?: AggregateDim | AggregateDim[];
  filters: AggregateFilters;
}

export interface TimeSeriesInput {
  entity: AggregateEntity;
  granularity: "week" | "month";
  groupBy?: AggregateDim;
  filters: AggregateFilters;
}

export interface AggregateFilters {
  teamId: string | null;
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  themeName?: string;
  chunkTypes?: string[];
  severity?: "low" | "medium" | "high";
  urgency?: "low" | "medium" | "high" | "critical";
  confidenceMin?: number;
}

export type AggregateResult =
  | { count: number }
  | { distribution: Array<{ key: string; count: number }> }
  | {
      distribution: Array<{
        dimensions: Record<string, string>;
        count: number;
      }>;
    };

export interface TimeSeriesResult {
  granularity: "week" | "month";
  buckets: Array<{ periodStart: string; key?: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Mapping table (PRD § P1.R3)
// ---------------------------------------------------------------------------

function resolveAggregateAction(
  entity: AggregateEntity,
  groupBy: AggregateDim | AggregateDim[] | undefined
): QueryAction {
  const dims = Array.isArray(groupBy) ? groupBy : groupBy ? [groupBy] : [];

  if (entity === "clients" && dims.length === 0) return "count_clients";
  if (entity === "sessions" && dims.length === 0) return "count_sessions";
  if (entity === "sessions" && dims.length === 1 && dims[0] === "client") {
    return "sessions_per_client";
  }
  if (entity === "sessions" && dims.length === 1 && dims[0] === "sentiment") {
    return "sentiment_distribution";
  }
  if (entity === "signals" && dims.length === 1 && dims[0] === "urgency") {
    return "urgency_distribution";
  }
  if (entity === "signals" && dims.length === 1 && dims[0] === "theme") {
    return "top_themes";
  }
  if (
    entity === "signals" &&
    dims.length === 2 &&
    dims.includes("client") &&
    dims.includes("severity")
  ) {
    return "client_health_grid";
  }
  if (
    entity === "signals" &&
    dims.length === 2 &&
    dims.includes("theme") &&
    dims.includes("client")
  ) {
    return "theme_client_matrix";
  }
  if (entity === "signals" && dims.length === 1 && dims[0] === "client") {
    // competitive_mention_frequency only when chunk_type=competitive_mention
    // is also filtered, but the chat tool spec exposes that as a chunkTypes
    // filter, so map at the aggregate level and let the underlying domain
    // module honour the chunkTypes pre-filter.
    return "competitive_mention_frequency";
  }
  throw new Error(
    `Unsupported aggregate(entity=${entity}, groupBy=${JSON.stringify(groupBy)}). Valid combinations are listed in PRD-033 § P1.R3.`
  );
}

function resolveTimeSeriesAction(
  entity: AggregateEntity,
  groupBy: AggregateDim | undefined
): QueryAction {
  if (entity === "sessions" && !groupBy) return "sessions_over_time";
  if (entity === "signals" && groupBy === "theme") return "theme_trends";
  throw new Error(
    `Unsupported time_series(entity=${entity}, groupBy=${groupBy ?? "none"}). Valid combinations are listed in PRD-033 § P1.R3.`
  );
}

function toQueryFilters(
  filters: AggregateFilters,
  granularity?: "week" | "month"
): QueryFilters {
  return {
    teamId: filters.teamId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    clientName: filters.clientName,
    severity: filters.severity,
    urgency: filters.urgency,
    granularity: granularity,
    confidenceMin: filters.confidenceMin,
    chunkTypes: filters.chunkTypes,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function aggregate(
  input: AggregateInput,
  deps: { supabase: SupabaseClient }
): Promise<AggregateResult> {
  const action = resolveAggregateAction(input.entity, input.groupBy);
  console.log(
    `${LOG_PREFIX} aggregate — entity: ${input.entity}, groupBy: ${JSON.stringify(input.groupBy)}, action: ${action}`
  );

  const result = await executeQuery(
    deps.supabase,
    action,
    toQueryFilters(input.filters)
  );

  return reshapeAggregate(action, result.data, input);
}

export async function timeSeries(
  input: TimeSeriesInput,
  deps: { supabase: SupabaseClient }
): Promise<TimeSeriesResult> {
  const action = resolveTimeSeriesAction(input.entity, input.groupBy);
  console.log(
    `${LOG_PREFIX} timeSeries — entity: ${input.entity}, groupBy: ${input.groupBy ?? "none"}, granularity: ${input.granularity}, action: ${action}`
  );

  const result = await executeQuery(
    deps.supabase,
    action,
    toQueryFilters(input.filters, input.granularity)
  );

  return reshapeTimeSeries(input.granularity, result.data, !!input.groupBy);
}

// ---------------------------------------------------------------------------
// Result reshaping (loosely typed to keep this independent of domain types)
// ---------------------------------------------------------------------------

function reshapeAggregate(
  action: QueryAction,
  data: Record<string, unknown>,
  input: AggregateInput
): AggregateResult {
  if (action === "count_clients" || action === "count_sessions") {
    return { count: (data.count as number) ?? 0 };
  }

  // Single-dim distributions
  if (
    action === "sentiment_distribution" ||
    action === "urgency_distribution" ||
    action === "sessions_per_client" ||
    action === "top_themes" ||
    action === "competitive_mention_frequency"
  ) {
    const distribution = extractDistribution(data);
    return { distribution };
  }

  // Multi-dim distributions
  if (action === "client_health_grid" || action === "theme_client_matrix") {
    const distribution = extractMultiDimDistribution(data, input.groupBy);
    return { distribution };
  }

  return { count: 0 };
}

function extractDistribution(
  data: Record<string, unknown>
): Array<{ key: string; count: number }> {
  // Domain modules return varying shapes — try common ones.
  for (const k of [
    "distribution",
    "rows",
    "results",
    "data",
    "items",
    "themes",
    "clients",
    "sentiments",
    "urgencies",
  ]) {
    const v = data[k];
    if (Array.isArray(v)) {
      return (v as Array<Record<string, unknown>>).map((row) => ({
        key: String(
          row.label ?? row.key ?? row.name ?? row.client_name ?? row.theme_name ?? row.value ?? "unknown"
        ),
        count: Number(row.count ?? row.total ?? row.value ?? 0),
      }));
    }
  }
  return [];
}

function extractMultiDimDistribution(
  data: Record<string, unknown>,
  groupBy: AggregateDim | AggregateDim[] | undefined
): Array<{ dimensions: Record<string, string>; count: number }> {
  const dims = Array.isArray(groupBy) ? groupBy : groupBy ? [groupBy] : [];
  // Reuse the same array discovery
  let arr: Array<Record<string, unknown>> | null = null;
  for (const k of ["distribution", "rows", "matrix", "data", "items"]) {
    const v = data[k];
    if (Array.isArray(v)) {
      arr = v as Array<Record<string, unknown>>;
      break;
    }
  }
  if (!arr) return [];

  return arr.map((row) => {
    const dimensions: Record<string, string> = {};
    for (const dim of dims) {
      const candidates =
        dim === "client"
          ? ["client_name", "client", "name"]
          : dim === "theme"
            ? ["theme_name", "theme", "name"]
            : [dim];
      for (const c of candidates) {
        if (row[c] !== undefined) {
          dimensions[dim] = String(row[c]);
          break;
        }
      }
    }
    return {
      dimensions,
      count: Number(row.count ?? row.total ?? 0),
    };
  });
}

function reshapeTimeSeries(
  granularity: "week" | "month",
  data: Record<string, unknown>,
  hasGroupBy: boolean
): TimeSeriesResult {
  let arr: Array<Record<string, unknown>> | null = null;
  for (const k of ["buckets", "rows", "data", "series", "trends", "results"]) {
    const v = data[k];
    if (Array.isArray(v)) {
      arr = v as Array<Record<string, unknown>>;
      break;
    }
  }
  if (!arr) return { granularity, buckets: [] };

  const buckets = arr.map((row) => {
    const periodStart = String(
      row.period_start ?? row.bucket ?? row.date ?? row.week ?? row.month ?? ""
    );
    const count = Number(row.count ?? row.total ?? row.value ?? 0);
    if (hasGroupBy) {
      return {
        periodStart,
        key: String(row.theme_name ?? row.key ?? row.name ?? "unknown"),
        count,
      };
    }
    return { periodStart, count };
  });

  return { granularity, buckets };
}
