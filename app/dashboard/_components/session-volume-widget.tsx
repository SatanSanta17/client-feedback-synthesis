"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { cn } from "@/lib/utils";
import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionVolumeWidgetProps {
  className?: string;
}

interface Bucket {
  bucket: string;
  count: number;
}

interface SessionVolumeData {
  buckets: Bucket[];
}

type Granularity = "week" | "month";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBucketLabel(dateStr: string, granularity: Granularity): string {
  const date = new Date(dateStr);
  if (granularity === "month") {
    return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// SessionVolumeWidget
// ---------------------------------------------------------------------------

export function SessionVolumeWidget({ className }: SessionVolumeWidgetProps) {
  const [granularity, setGranularity] = useState<Granularity>("week");

  const { data, isLoading, error, refetch } =
    useDashboardFetch<SessionVolumeData>({
      action: "sessions_over_time",
      extraParams: { granularity },
    });

  const chartData = useMemo(() => {
    if (!data?.buckets) return [];
    return data.buckets.map((b) => ({
      label: formatBucketLabel(b.bucket, granularity),
      count: b.count,
    }));
  }, [data, granularity]);

  const isEmpty = !data || chartData.length === 0;

  return (
    <DashboardCard
      title="Session Volume Over Time"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="No session data for the selected filters"
      className={className}
    >
      {/* Granularity toggle — local to this widget */}
      <div className="mb-2 flex items-center gap-1">
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

      <ResponsiveContainer width="100%" height={190}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
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
          <Tooltip formatter={(value) => [value, "Sessions"]} />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#6366f1"
            fill="#6366f1"
            fillOpacity={0.15}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </DashboardCard>
  );
}
