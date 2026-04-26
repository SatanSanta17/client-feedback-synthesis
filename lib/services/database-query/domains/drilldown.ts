// ---------------------------------------------------------------------------
// Database Query — Drill-down Router
// ---------------------------------------------------------------------------
// Parses the `drillDown` filter (a JSON-encoded discriminated union),
// dispatches to the strategy module that owns its row fetch, then groups
// the resulting rows by client and applies the DRILL_DOWN_LIMIT cap.
//
// Strategy modules:
//   - drilldown-direct.ts → sentiment, urgency, client, competitor
//   - drilldown-theme.ts  → theme, theme_bucket, theme_client
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { LOG_PREFIX } from "../action-metadata";
import type { DrillDownRow, QueryFilters } from "../types";
import {
  fetchDirectDrillDownRows,
  handleCompetitorDrillDown,
} from "./drilldown-direct";
import { fetchThemeDrillDownRows } from "./drilldown-theme";

/** Zod schema for the drill-down JSON payload — discriminated union on `type`. */
const drillDownSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sentiment"),
    value: z.enum(["positive", "negative", "neutral", "mixed"]),
  }),
  z.object({
    type: z.literal("urgency"),
    value: z.enum(["low", "medium", "high", "critical"]),
  }),
  z.object({
    type: z.literal("client"),
    clientId: z.string().min(1),
    clientName: z.string().min(1),
  }),
  z.object({
    type: z.literal("competitor"),
    competitor: z.string().min(1),
  }),
  z.object({
    type: z.literal("theme"),
    themeId: z.string().min(1),
    themeName: z.string().min(1),
  }),
  z.object({
    type: z.literal("theme_bucket"),
    themeId: z.string().min(1),
    themeName: z.string().min(1),
    bucket: z.string().min(1),
  }),
  z.object({
    type: z.literal("theme_client"),
    themeId: z.string().min(1),
    themeName: z.string().min(1),
    clientId: z.string().min(1),
    clientName: z.string().min(1),
  }),
]);

/** Max signals returned by a drill-down query. */
const DRILL_DOWN_LIMIT = 100;

/**
 * Builds the filter label displayed in the drill-down panel header.
 */
function buildFilterLabel(ctx: z.infer<typeof drillDownSchema>): string {
  switch (ctx.type) {
    case "sentiment":
      return `Sentiment: ${ctx.value.charAt(0).toUpperCase() + ctx.value.slice(1)}`;
    case "urgency":
      return `Urgency: ${ctx.value.charAt(0).toUpperCase() + ctx.value.slice(1)}`;
    case "client":
      return `Client: ${ctx.clientName}`;
    case "competitor":
      return `Competitor: ${ctx.competitor}`;
    case "theme":
      return `Theme: ${ctx.themeName}`;
    case "theme_bucket":
      return `Theme: ${ctx.themeName} (${ctx.bucket})`;
    case "theme_client":
      return `Theme: ${ctx.themeName} + Client: ${ctx.clientName}`;
  }
}

/**
 * Groups flat signal rows by client, enforcing the DRILL_DOWN_LIMIT cap.
 * Returns the grouped response shape expected by DrillDownResult.
 */
function groupByClient(
  rows: DrillDownRow[],
  filterLabel: string
): Record<string, unknown> {
  const totalSignals = rows.length;

  // Cap at DRILL_DOWN_LIMIT (rows are already sorted by session_date desc)
  const capped = rows.slice(0, DRILL_DOWN_LIMIT);

  const clientMap = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      signals: Array<{
        embeddingId: string;
        sessionId: string;
        sessionDate: string;
        chunkText: string;
        chunkType: string;
        themeName: string | null;
        metadata: Record<string, unknown>;
      }>;
    }
  >();

  for (const row of capped) {
    let group = clientMap.get(row.clientId);
    if (!group) {
      group = {
        clientId: row.clientId,
        clientName: row.clientName,
        signals: [],
      };
      clientMap.set(row.clientId, group);
    }
    group.signals.push({
      embeddingId: row.embeddingId,
      sessionId: row.sessionId,
      sessionDate: row.sessionDate,
      chunkText: row.chunkText,
      chunkType: row.chunkType,
      themeName: row.themeName,
      metadata: row.metadata,
    });
  }

  const clients = Array.from(clientMap.values())
    .map((g) => ({
      ...g,
      signalCount: g.signals.length,
    }))
    .sort((a, b) => b.signalCount - a.signalCount);

  return {
    filterLabel,
    totalSignals,
    totalClients: clients.length,
    clients,
  };
}

/**
 * Main drill-down handler. Parses the drillDown JSON, dispatches to the
 * appropriate strategy, groups results by client, and returns the response.
 */
export async function handleDrillDown(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  if (!filters.drillDown) {
    throw new Error("drill_down action requires a drillDown filter");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(filters.drillDown);
  } catch {
    throw new Error("drillDown filter is not valid JSON");
  }

  const result = drillDownSchema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join(", ");
    throw new Error(`Invalid drillDown payload: ${msg}`);
  }

  const ctx = result.data;
  const filterLabel = buildFilterLabel(ctx);

  console.log(
    `${LOG_PREFIX} handleDrillDown — type: ${ctx.type}, label: "${filterLabel}"`
  );

  let rows: DrillDownRow[];

  switch (ctx.type) {
    case "sentiment":
      rows = await fetchDirectDrillDownRows(supabase, filters, {
        jsonField: "sentiment",
        jsonValue: ctx.value,
      });
      break;
    case "urgency":
      rows = await fetchDirectDrillDownRows(supabase, filters, {
        jsonField: "urgency",
        jsonValue: ctx.value,
      });
      break;
    case "client":
      rows = await fetchDirectDrillDownRows(supabase, filters, {
        clientId: ctx.clientId,
      });
      break;
    case "competitor":
      rows = await handleCompetitorDrillDown(
        supabase,
        filters,
        ctx.competitor
      );
      break;
    case "theme":
      rows = await fetchThemeDrillDownRows(supabase, filters, ctx.themeId);
      break;
    case "theme_bucket":
      rows = await fetchThemeDrillDownRows(supabase, filters, ctx.themeId, {
        bucket: ctx.bucket,
      });
      break;
    case "theme_client":
      rows = await fetchThemeDrillDownRows(supabase, filters, ctx.themeId, {
        clientId: ctx.clientId,
      });
      break;
  }

  return groupByClient(rows, filterLabel);
}
