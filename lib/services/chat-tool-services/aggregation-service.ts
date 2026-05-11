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
  /** Required for SECURITY DEFINER RPCs that scope personal workspaces explicitly. */
  userId?: string;
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
    dims.includes("theme") &&
    dims.includes("client")
  ) {
    return "theme_client_matrix";
  }
  // Note: the dashboard's `client_health_grid` action is intentionally not
  // routed here. Its handler returns a per-client (sentiment, urgency)
  // snapshot — it does not carry per-row severity, so any [client, severity]
  // request cannot be satisfied from its output. Falling through to the
  // explicit "Unsupported" error below lets the chat model recover instead of
  // silently receiving an empty distribution (PRD-033 audit fix, 2026-05-11).
  if (entity === "signals" && dims.length === 1 && dims[0] === "client") {
    // Generic per-client signal count, filterable by chunkTypes. The
    // dashboard's `competitive_mention_frequency` handler counts COMPETITOR
    // names from structured_json (a different shape) and was wrongly routed
    // here pre-audit (2026-05-11) — see PRD-033 audit fixes.
    return "signals_per_client";
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
    userId: filters.userId,
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

  return reshapeTimeSeries(action, input.granularity, result.data);
}

// ---------------------------------------------------------------------------
// Result reshaping
// ---------------------------------------------------------------------------
// Every action returned by resolveAggregateAction / resolveTimeSeriesAction
// has a dedicated reshape branch. The previous generic key-scanning
// implementation silently produced empty distributions when a domain module's
// shape didn't match its key heuristics (PRD-033 audit, 2026-05-11) — every
// shape mismatch now either reshapes correctly or throws loudly so the chat
// model can recover instead of confidently reporting "no data."
// ---------------------------------------------------------------------------

function reshapeAggregate(
  action: QueryAction,
  data: Record<string, unknown>,
  _input: AggregateInput
): AggregateResult {
  if (action === "count_clients" || action === "count_sessions") {
    return { count: (data.count as number) ?? 0 };
  }

  if (action === "sentiment_distribution" || action === "urgency_distribution") {
    return { distribution: reshapeFlatRecord(data) };
  }

  if (
    action === "sessions_per_client" ||
    action === "signals_per_client" ||
    action === "top_themes"
  ) {
    return { distribution: reshapeNamedDistribution(data, action) };
  }

  if (action === "theme_client_matrix") {
    return { distribution: reshapeThemeClientMatrix(data) };
  }

  // No silent fallback — unknown actions are routing bugs, not "zero results".
  throw new Error(
    `reshapeAggregate: unhandled action "${action}". This is a routing bug — every action returned by resolveAggregateAction must have a corresponding reshape branch.`
  );
}

function reshapeTimeSeries(
  action: QueryAction,
  granularity: "week" | "month",
  data: Record<string, unknown>
): TimeSeriesResult {
  if (action === "sessions_over_time") {
    return reshapeSessionsOverTime(granularity, data);
  }
  if (action === "theme_trends") {
    return reshapeThemeTrends(granularity, data);
  }
  throw new Error(
    `reshapeTimeSeries: unhandled action "${action}". This is a routing bug — every action returned by resolveTimeSeriesAction must have a corresponding reshape branch.`
  );
}

// ---------------------------------------------------------------------------
// Per-action reshape helpers
// ---------------------------------------------------------------------------

/**
 * Reshapes a flat `{ bucket: count, ... }` record into the chat distribution
 * shape. Used by sentiment_distribution and urgency_distribution, whose domain
 * handlers return e.g. `{ positive: 5, negative: 3, neutral: 2, mixed: 0 }`.
 * Zero-count buckets are preserved so the model can see the full distribution.
 */
function reshapeFlatRecord(
  data: Record<string, unknown>
): Array<{ key: string; count: number }> {
  return Object.entries(data)
    .filter(([, v]) => typeof v === "number")
    .map(([key, v]) => ({ key, count: Number(v) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Reshapes a `{ <wrapperKey>: [{ name|themeName, count }] }` payload into the
 * chat distribution shape. Used by handlers whose result wraps the array
 * under a domain-specific key (e.g. `clients`, `themes`). The accepted name
 * fields cover both snake_case (legacy) and camelCase (current convention).
 */
function reshapeNamedDistribution(
  data: Record<string, unknown>,
  action: QueryAction
): Array<{ key: string; count: number }> {
  for (const wrapper of ["themes", "clients", "distribution", "rows", "items"]) {
    const arr = data[wrapper];
    if (!Array.isArray(arr)) continue;
    return (arr as Array<Record<string, unknown>>).map((row, index) => {
      const rawKey =
        row.themeName ??
        row.theme_name ??
        row.clientName ??
        row.client_name ??
        row.name ??
        row.label ??
        row.key;
      if (rawKey === undefined || rawKey === null) {
        console.warn(
          `${LOG_PREFIX} reshapeNamedDistribution — row ${index} of action "${action}" missing a label field. Row keys: ${Object.keys(row).join(", ")}`
        );
      }
      return {
        key: String(rawKey ?? "(missing label)"),
        count: Number(row.count ?? row.total ?? row.value ?? 0),
      };
    });
  }
  console.warn(
    `${LOG_PREFIX} reshapeNamedDistribution — no candidate array wrapper key matched for action "${action}". Data keys: ${Object.keys(data).join(", ") || "(empty)"}.`
  );
  return [];
}

/**
 * Reshapes the theme_client_matrix payload `{ themes: [{id, name}], clients:
 * [{id, name}], cells: [{themeId, clientId, count}] }` into a flat two-dim
 * distribution. Cell rows carry only IDs, so theme/client names are resolved
 * from the sibling arrays. Previously the generic extractor scanned for one
 * of `distribution/rows/matrix/data/items` and never found `cells`, silently
 * returning an empty distribution.
 */
function reshapeThemeClientMatrix(
  data: Record<string, unknown>
): Array<{ dimensions: Record<string, string>; count: number }> {
  const themes = data.themes;
  const clients = data.clients;
  const cells = data.cells;
  if (!Array.isArray(themes) || !Array.isArray(clients) || !Array.isArray(cells)) {
    console.warn(
      `${LOG_PREFIX} reshapeThemeClientMatrix — expected { themes, clients, cells } arrays. Got keys: ${Object.keys(data).join(", ") || "(empty)"}.`
    );
    return [];
  }

  const themeName = new Map<string, string>();
  for (const t of themes as Array<{ id?: string; name?: string }>) {
    if (t.id) themeName.set(t.id, t.name ?? t.id);
  }
  const clientName = new Map<string, string>();
  for (const c of clients as Array<{ id?: string; name?: string }>) {
    if (c.id) clientName.set(c.id, c.name ?? c.id);
  }

  return (cells as Array<{ themeId?: string; clientId?: string; count?: number }>).map(
    (cell) => ({
      dimensions: {
        theme: themeName.get(cell.themeId ?? "") ?? cell.themeId ?? "(unknown theme)",
        client: clientName.get(cell.clientId ?? "") ?? cell.clientId ?? "(unknown client)",
      },
      count: Number(cell.count ?? 0),
    })
  );
}

/**
 * Reshapes the sessions_over_time RPC payload `{ buckets: [{bucket|period_start,
 * count}] }` into the chat time-series shape. The RPC has shipped two field
 * names historically; both are accepted.
 */
function reshapeSessionsOverTime(
  granularity: "week" | "month",
  data: Record<string, unknown>
): TimeSeriesResult {
  const raw = data.buckets;
  if (!Array.isArray(raw)) {
    console.warn(
      `${LOG_PREFIX} reshapeSessionsOverTime — expected buckets array. Data keys: ${Object.keys(data).join(", ") || "(empty)"}.`
    );
    return { granularity, buckets: [] };
  }
  const buckets = (raw as Array<Record<string, unknown>>).map((row) => ({
    periodStart: String(row.period_start ?? row.bucket ?? ""),
    count: Number(row.count ?? row.total ?? row.value ?? 0),
  }));
  return { granularity, buckets };
}

/**
 * Reshapes the theme_trends payload `{ themes: [{themeId, themeName}],
 * buckets: [{bucket, counts: {[themeId]: number}}] }` into a flat per-(bucket,
 * theme) time-series. Each non-zero cell becomes one output bucket entry with
 * the resolved theme name. Previously the generic time-series reshaper read
 * `row.count` (always undefined here, since counts are nested) and `row.theme_name`
 * (never present), so every entry came back as `{ count: 0, key: "unknown" }`.
 */
function reshapeThemeTrends(
  granularity: "week" | "month",
  data: Record<string, unknown>
): TimeSeriesResult {
  const themes = data.themes;
  const rawBuckets = data.buckets;
  if (!Array.isArray(themes) || !Array.isArray(rawBuckets)) {
    console.warn(
      `${LOG_PREFIX} reshapeThemeTrends — expected { themes, buckets } arrays. Got keys: ${Object.keys(data).join(", ") || "(empty)"}.`
    );
    return { granularity, buckets: [] };
  }

  const themeName = new Map<string, string>();
  for (const t of themes as Array<{ themeId?: string; themeName?: string }>) {
    if (t.themeId) themeName.set(t.themeId, t.themeName ?? t.themeId);
  }

  const out: TimeSeriesResult["buckets"] = [];
  for (const b of rawBuckets as Array<{
    bucket?: string;
    counts?: Record<string, number>;
  }>) {
    const periodStart = String(b.bucket ?? "");
    const counts = b.counts ?? {};
    for (const [themeId, count] of Object.entries(counts)) {
      if (!count) continue;
      out.push({
        periodStart,
        key: themeName.get(themeId) ?? themeId,
        count: Number(count),
      });
    }
  }
  return { granularity, buckets: out };
}
