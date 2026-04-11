"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";
import { THEME_LINE_COLOURS } from "./chart-colours";
import type { DrillDownContext } from "./drill-down-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThemeTrendsWidgetProps {
  className?: string;
  onDrillDown?: (context: DrillDownContext) => void;
}

interface ThemeMeta {
  themeId: string;
  themeName: string;
}

interface Bucket {
  bucket: string;
  counts: Record<string, number>;
}

interface ThemeTrendsData {
  themes: ThemeMeta[];
  buckets: Bucket[];
}

type Granularity = "week" | "month";

const DEFAULT_VISIBLE_COUNT = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBucketLabel(dateStr: string, granularity: Granularity): string {
  const date = new Date(dateStr);
  if (granularity === "month") {
    return date.toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit",
    });
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Rank themes by total signal count across all buckets (descending).
 */
function rankThemesByTotal(
  themes: ThemeMeta[],
  buckets: Bucket[]
): ThemeMeta[] {
  const totals = new Map<string, number>();
  for (const b of buckets) {
    for (const [tid, count] of Object.entries(b.counts)) {
      totals.set(tid, (totals.get(tid) ?? 0) + count);
    }
  }
  return [...themes].sort(
    (a, b) => (totals.get(b.themeId) ?? 0) - (totals.get(a.themeId) ?? 0)
  );
}

// ---------------------------------------------------------------------------
// ThemeTrendsWidget
// ---------------------------------------------------------------------------

export function ThemeTrendsWidget({ className, onDrillDown }: ThemeTrendsWidgetProps) {
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [themePopoverOpen, setThemePopoverOpen] = useState(false);

  // null = use default top-5; once the user interacts, we track explicitly
  const [selectedThemeIds, setSelectedThemeIds] = useState<Set<string> | null>(
    null
  );

  const { data, isLoading, error, refetch } =
    useDashboardFetch<ThemeTrendsData>({
      action: "theme_trends",
      extraParams: { granularity },
    });

  const allThemes = data?.themes ?? [];
  const buckets = data?.buckets ?? [];
  const isEmpty = allThemes.length === 0 || buckets.length === 0;

  // Rank by total count and derive visible set
  const rankedThemes = useMemo(
    () => rankThemesByTotal(allThemes, buckets),
    [allThemes, buckets]
  );

  const visibleIds = useMemo(() => {
    if (selectedThemeIds) return selectedThemeIds;
    // Default: top 5
    return new Set(
      rankedThemes.slice(0, DEFAULT_VISIBLE_COUNT).map((t) => t.themeId)
    );
  }, [selectedThemeIds, rankedThemes]);

  // Build chart data: one object per bucket with a key per visible theme
  const chartData = useMemo(() => {
    return buckets.map((b) => {
      const point: Record<string, string | number> = {
        label: formatBucketLabel(b.bucket, granularity),
      };
      for (const tid of visibleIds) {
        point[tid] = b.counts[tid] ?? 0;
      }
      return point;
    });
  }, [buckets, visibleIds, granularity]);

  // Map theme IDs to names for legend/tooltip
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allThemes) {
      m.set(t.themeId, t.themeName);
    }
    return m;
  }, [allThemes]);

  // Theme selector toggle
  const toggleTheme = (themeId: string) => {
    setSelectedThemeIds((prev) => {
      const current = prev
        ? new Set(prev)
        : new Set(
            rankedThemes
              .slice(0, DEFAULT_VISIBLE_COUNT)
              .map((t) => t.themeId)
          );
      if (current.has(themeId)) {
        current.delete(themeId);
      } else {
        current.add(themeId);
      }
      return current;
    });
  };

  const visibleThemeLabel =
    visibleIds.size === 0
      ? "No themes"
      : visibleIds.size <= 2
        ? Array.from(visibleIds)
            .map((id) => nameMap.get(id) ?? id)
            .join(", ")
        : `${visibleIds.size} themes`;

  return (
    <DashboardCard
      title="Theme Trends"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="Themes will appear as you extract more sessions"
      className={cn("lg:col-span-2", className)}
    >
      {/* Controls row: granularity toggle + theme selector */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {/* Granularity toggle */}
        <div className="flex items-center gap-1">
          {(["week", "month"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                granularity === g
                  ? "bg-[var(--brand-primary)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]"
              )}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>

        {/* Theme multi-select */}
        <Popover open={themePopoverOpen} onOpenChange={setThemePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              role="combobox"
              aria-expanded={themePopoverOpen}
              className="min-w-[120px] justify-between text-xs"
            >
              <span className="truncate">{visibleThemeLabel}</span>
              <ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search themes…" />
              <CommandList>
                <CommandEmpty>No themes found.</CommandEmpty>
                <CommandGroup>
                  {rankedThemes.map((theme) => {
                    const isSelected = visibleIds.has(theme.themeId);
                    return (
                      <CommandItem
                        key={theme.themeId}
                        value={theme.themeName}
                        onSelect={() => toggleTheme(theme.themeId)}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4",
                            isSelected ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {theme.themeName}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={chartData}
          margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--border-default)"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value, name) => [
              value,
              nameMap.get(String(name)) ?? String(name),
            ]}
            labelFormatter={(label) => String(label)}
          />
          <Legend
            formatter={(value) => (
              <span className="text-xs">
                {nameMap.get(String(value)) ?? String(value)}
              </span>
            )}
          />
          {Array.from(visibleIds).map((tid, idx) => (
            <Line
              key={tid}
              type="monotone"
              dataKey={tid}
              stroke={THEME_LINE_COLOURS[idx % THEME_LINE_COLOURS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{
                r: 5,
                style: { cursor: "pointer" },
                onClick: (_event: unknown, payload: unknown) => {
                  const point = payload as { payload?: Record<string, string | number> };
                  const bucket = point?.payload?.label as string | undefined;
                  if (bucket) {
                    onDrillDown?.({
                      type: "theme_bucket",
                      themeId: tid,
                      themeName: nameMap.get(tid) ?? tid,
                      bucket,
                    });
                  }
                },
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </DashboardCard>
  );
}
