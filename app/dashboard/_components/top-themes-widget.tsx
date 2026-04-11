"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";
import { BRAND_PRIMARY_HEX } from "./chart-colours";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopThemesWidgetProps {
  className?: string;
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DISPLAY_LIMIT = 15;

/**
 * Human-readable labels for chunk_type keys.
 */
const CHUNK_TYPE_LABELS: Record<string, string> = {
  pain_point: "Pain points",
  requirement: "Requirements",
  blocker: "Blockers",
  aspiration: "Aspirations",
  competitive_mention: "Competitive mentions",
  tool_and_platform: "Tools & platforms",
  client_profile: "Client profiles",
  summary: "Summaries",
  custom: "Custom",
  raw: "Raw",
};

function formatChunkType(key: string): string {
  return CHUNK_TYPE_LABELS[key] ?? key.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

interface BreakdownTooltipProps {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Tooltip payload is loosely typed
  payload?: any[];
}

function BreakdownTooltip({ active, payload }: BreakdownTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0].payload as ThemeEntry;

  // Sort breakdown by count descending
  const sorted = Object.entries(entry.breakdown).sort(
    ([, a], [, b]) => b - a
  );

  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-gray-900">{entry.themeName}</p>
      <p className="mb-1 text-gray-500">{entry.count} total signals</p>
      {sorted.map(([type, count]) => (
        <p key={type} className="text-gray-600">
          {count} {formatChunkType(type)}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopThemesWidget
// ---------------------------------------------------------------------------

export function TopThemesWidget({ className }: TopThemesWidgetProps) {
  const { data, isLoading, error, refetch } =
    useDashboardFetch<TopThemesData>({ action: "top_themes" });

  const [showAll, setShowAll] = useState(false);

  const allThemes = data?.themes ?? [];
  const isEmpty = allThemes.length === 0;
  const hasMore = allThemes.length > DEFAULT_DISPLAY_LIMIT;
  const displayThemes = showAll
    ? allThemes
    : allThemes.slice(0, DEFAULT_DISPLAY_LIMIT);

  // Dynamic height: at least 160px, grow with number of themes
  const chartHeight = Math.max(160, displayThemes.length * 32 + 40);

  return (
    <DashboardCard
      title="Top Themes"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="Themes will appear as you extract more sessions"
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
            width={140}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<BreakdownTooltip />} />
          <Bar
            dataKey="count"
            fill={BRAND_PRIMARY_HEX}
            radius={[0, 4, 4, 0]}
            onClick={(entry) => {
              // Drill-down wired in Part 4
              const theme = entry as unknown as ThemeEntry;
              console.log("[TopThemesWidget] clicked:", theme.themeId);
            }}
            style={{ cursor: "pointer" }}
          />
        </BarChart>
      </ResponsiveContainer>

      {hasMore && (
        <div className="mt-2 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((prev) => !prev)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {showAll
              ? "Show top 15"
              : `Show all ${allThemes.length} themes`}
          </Button>
        </div>
      )}
    </DashboardCard>
  );
}
