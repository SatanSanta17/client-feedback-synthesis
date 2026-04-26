// ---------------------------------------------------------------------------
// Database Query — Themes Domain
// ---------------------------------------------------------------------------
// Theme widget handlers: top_themes, theme_trends, theme_client_matrix.
// All three share the same signal_themes ⨝ session_embeddings ⨝ sessions
// join (via fetchSignalThemeRows) and the active-themes Map (via
// fetchActiveThemeMap). theme_client_matrix additionally fetches the full
// active-clients list for the matrix's column dimension — that fetch is
// inline because it's specific to the matrix's "all clients in scope" need.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { LOG_PREFIX } from "../action-metadata";
import { baseClientQuery } from "../shared/base-query-builder";
import { dateTrunc } from "../shared/row-helpers";
import {
  fetchActiveThemeMap,
  fetchSignalThemeRows,
} from "../shared/theme-helpers";
import type { QueryFilters } from "../types";

export async function handleTopThemes(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const [themeMap, rows] = await Promise.all([
    fetchActiveThemeMap(supabase, filters.teamId),
    fetchSignalThemeRows(supabase, filters),
  ]);

  // Aggregate by theme_id with chunk_type sub-counts
  const themeAgg = new Map<
    string,
    { count: number; breakdown: Record<string, number> }
  >();

  for (const row of rows) {
    const tid = row.theme_id;
    if (!themeMap.has(tid)) continue; // skip archived/deleted themes

    let agg = themeAgg.get(tid);
    if (!agg) {
      agg = { count: 0, breakdown: {} };
      themeAgg.set(tid, agg);
    }

    agg.count++;
    const chunkType = row.session_embeddings.chunk_type;
    agg.breakdown[chunkType] = (agg.breakdown[chunkType] ?? 0) + 1;
  }

  // Sort by total count descending
  const themes = Array.from(themeAgg.entries())
    .map(([themeId, { count, breakdown }]) => ({
      themeId,
      themeName: themeMap.get(themeId) ?? "Unknown",
      count,
      breakdown,
    }))
    .sort((a, b) => b.count - a.count);

  return { themes };
}

export async function handleThemeTrends(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const [themeMap, rows] = await Promise.all([
    fetchActiveThemeMap(supabase, filters.teamId),
    fetchSignalThemeRows(supabase, filters),
  ]);

  const granularity = filters.granularity ?? "week";

  // Group by (bucket, theme_id) in TypeScript
  const bucketMap = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const tid = row.theme_id;
    if (!themeMap.has(tid)) continue;

    const sessionDate = new Date(row.session_embeddings.sessions.session_date);
    const bucket = dateTrunc(granularity, sessionDate);

    let counts = bucketMap.get(bucket);
    if (!counts) {
      counts = {};
      bucketMap.set(bucket, counts);
    }
    counts[tid] = (counts[tid] ?? 0) + 1;
  }

  // Sort buckets chronologically
  const buckets = Array.from(bucketMap.entries())
    .map(([bucket, counts]) => ({ bucket, counts }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  // Build theme metadata list (only themes that appear in data)
  const seenThemeIds = new Set<string>();
  for (const { counts } of buckets) {
    for (const tid of Object.keys(counts)) {
      seenThemeIds.add(tid);
    }
  }

  const themes = Array.from(seenThemeIds).map((id) => ({
    themeId: id,
    themeName: themeMap.get(id) ?? "Unknown",
  }));

  return { themes, buckets };
}

export async function handleThemeClientMatrix(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // Need client names — fetch from sessions join with clients
  const [themeMap, rows, clientData] = await Promise.all([
    fetchActiveThemeMap(supabase, filters.teamId),
    fetchSignalThemeRows(supabase, filters),
    (async () => {
      const q = baseClientQuery(
        supabase
          .from("clients")
          .select("id, name")
          .order("name", { ascending: true }),
        filters
      );
      const { data, error } = await q;
      if (error) {
        console.error(`${LOG_PREFIX} theme_client_matrix client fetch error:`, error);
        throw new Error("Failed to fetch clients for theme matrix");
      }
      return (data ?? []) as Array<{ id: string; name: string }>;
    })(),
  ]);

  const clientMap = new Map<string, string>();
  for (const c of clientData) {
    clientMap.set(c.id, c.name);
  }

  // Group by (theme_id, client_id) — sparse cells
  const cellMap = new Map<string, number>(); // "themeId|clientId" → count
  const seenThemeIds = new Set<string>();
  const seenClientIds = new Set<string>();

  for (const row of rows) {
    const tid = row.theme_id;
    if (!themeMap.has(tid)) continue;

    const clientId = row.session_embeddings.sessions.client_id;
    if (!clientMap.has(clientId)) continue;

    const key = `${tid}|${clientId}`;
    cellMap.set(key, (cellMap.get(key) ?? 0) + 1);
    seenThemeIds.add(tid);
    seenClientIds.add(clientId);
  }

  const themesList = Array.from(seenThemeIds).map((id) => ({
    id,
    name: themeMap.get(id) ?? "Unknown",
  }));

  const clientsList = Array.from(seenClientIds).map((id) => ({
    id,
    name: clientMap.get(id) ?? "Unknown",
  }));

  const cells = Array.from(cellMap.entries()).map(([key, count]) => {
    const [themeId, clientId] = key.split("|");
    return { themeId, clientId, count };
  });

  return { themes: themesList, clients: clientsList, cells };
}
