"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { GitMerge } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";
import { useRecentlyMergedThemes } from "./use-recently-merged-themes";
import { WIN_BAR_HEX, formatChunkTypePlural } from "./chart-colours";
import type { DrillDownContext } from "./drill-down-types";

/**
 * Top Wins — PRD-031 P2.R9.
 *
 * Surfaces the themes clients most often praise (i.e. themes with the most
 * `positive_signal` contributions) at the top level of the dashboard,
 * alongside Top Themes. Same shape as Top Themes with four deliberate
 * differences:
 *
 * 1. Calls `top_themes` with `chunkTypes=positive_signal` so the underlying
 *    `signal_themes ⨝ session_embeddings` join is pre-filtered to positives.
 * 2. Bar fill is `WIN_BAR_HEX` (green-500) so the widget reads visually as
 *    wins at a glance.
 * 3. Self-hides via early `null` return when the workspace has no
 *    positive-signal data — no empty placeholder slot. This is the on-purpose
 *    behaviour from P2.R9 + the hide-empty intent of P2.R6.
 * 4. Drill-down emits `chunkTypes: ["positive_signal"]` on the discriminated
 *    union so the panel scopes to positive-signal rows for the clicked theme,
 *    not every chunk type contributing to it.
 *
 * The "Recently merged" suffix marker is preserved from Top Themes — merged
 * canonical themes can still appear in Top Wins, and the indicator is an
 * orthogonal concern (PRD-026 Part 4).
 */

const RECENTLY_MERGED_SUFFIX = " ⤳";
const POSITIVE_SIGNAL_FILTER = "positive_signal";
const DEFAULT_DISPLAY_LIMIT = 15;

interface TopWinsWidgetProps {
  className?: string;
  onDrillDown?: (context: DrillDownContext) => void;
}

interface ThemeEntry {
  themeId: string;
  themeName: string;
  count: number;
  breakdown: Record<string, number>;
}

interface TopThemesData {
  themes: ThemeEntry[];
}

interface BreakdownTooltipProps {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Tooltip payload is loosely typed
  payload?: any[];
}

function BreakdownTooltip({ active, payload }: BreakdownTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0].payload as ThemeEntry;

  // Top Wins is filtered to positive_signal so the breakdown is single-bucket
  // for now; we keep the same tooltip shape as Top Themes for visual parity
  // and so future widget variants (multi-chunk-type wins) can render without
  // a tooltip rewrite.
  const sorted = Object.entries(entry.breakdown).sort(([, a], [, b]) => b - a);

  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-gray-900">{entry.themeName}</p>
      <p className="mb-1 text-gray-500">{entry.count} total signals</p>
      {sorted.map(([type, count]) => (
        <p key={type} className="text-gray-600">
          {count} {formatChunkTypePlural(type)}
        </p>
      ))}
    </div>
  );
}

export function TopWinsWidget({ className, onDrillDown }: TopWinsWidgetProps) {
  const { data, isLoading, error, refetch } = useDashboardFetch<TopThemesData>({
    action: "top_themes",
    extraParams: { chunkTypes: POSITIVE_SIGNAL_FILTER },
  });

  const recentlyMergedSet = useRecentlyMergedThemes();

  const [showAll, setShowAll] = useState(false);

  const allThemes = data?.themes ?? [];
  const isEmpty = allThemes.length === 0;
  const hasMore = allThemes.length > DEFAULT_DISPLAY_LIMIT;
  const displayThemes = showAll
    ? allThemes
    : allThemes.slice(0, DEFAULT_DISPLAY_LIMIT);

  const tickLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allThemes) {
      m.set(
        t.themeName,
        recentlyMergedSet.has(t.themeId)
          ? `${t.themeName}${RECENTLY_MERGED_SUFFIX}`
          : t.themeName
      );
    }
    return m;
  }, [allThemes, recentlyMergedSet]);

  const hasAnyRecentlyMerged = displayThemes.some((t) =>
    recentlyMergedSet.has(t.themeId)
  );

  // Self-hide on empty (P2.R9). We still render the loading and error states
  // so the user sees the slot resolve naturally; only after a successful
  // fetch with zero results do we drop the slot entirely.
  if (!isLoading && !error && isEmpty) {
    return null;
  }

  const chartHeight = Math.max(160, displayThemes.length * 32 + 40);

  return (
    <DashboardCard
      title="Top Wins"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="Wins will appear once positive client feedback is captured"
      className={cn("lg:col-span-2", className)}
    >
      <ResponsiveContainer width="100%" height={Math.min(chartHeight, 520)}>
        <BarChart
          data={displayThemes}
          layout="vertical"
          margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
        >
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="themeName"
            tick={{ fontSize: 12 }}
            tickFormatter={(value: string) => tickLabelMap.get(value) ?? value}
            width={140}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<BreakdownTooltip />} />
          <Bar
            dataKey="count"
            fill={WIN_BAR_HEX}
            radius={[0, 4, 4, 0]}
            onClick={(entry) => {
              const theme = entry as unknown as ThemeEntry;
              onDrillDown?.({
                type: "theme",
                themeId: theme.themeId,
                themeName: theme.themeName,
                chunkTypes: [POSITIVE_SIGNAL_FILTER],
              });
            }}
            style={{ cursor: "pointer" }}
          />
        </BarChart>
      </ResponsiveContainer>

      {hasAnyRecentlyMerged && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <GitMerge className="size-3" aria-hidden />
          <span>
            <span aria-hidden>⤳</span> indicates a recently merged theme.
          </span>
        </p>
      )}

      {hasMore && (
        <div className="mt-2 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((prev) => !prev)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {showAll ? "Show top 15" : `Show all ${allThemes.length} wins`}
          </Button>
        </div>
      )}
    </DashboardCard>
  );
}
