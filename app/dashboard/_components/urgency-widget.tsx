"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";
import { URGENCY_COLOURS } from "./chart-colours";
import type { DrillDownContext } from "./drill-down-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UrgencyWidgetProps {
  className?: string;
  onDrillDown?: (context: DrillDownContext) => void;
  onFilter?: (filters: Record<string, string>) => void;
}

interface UrgencyData {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

const URGENCY_KEYS = ["low", "medium", "high", "critical"] as const;

// ---------------------------------------------------------------------------
// UrgencyWidget
// ---------------------------------------------------------------------------

export function UrgencyWidget({ className, onDrillDown, onFilter }: UrgencyWidgetProps) {
  const { data, isLoading, error, refetch } =
    useDashboardFetch<UrgencyData>({ action: "urgency_distribution" });

  const chartData = data
    ? URGENCY_KEYS.map((key) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value: data[key],
        key,
      }))
    : [];

  const isEmpty = !data || chartData.every((d) => d.value === 0);

  return (
    <DashboardCard
      title="Urgency Distribution"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="No urgency data for the selected filters"
      className={className}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => [value, "Sessions"]}
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            onClick={(entry, _index, event) => {
              const value = entry.key as "low" | "medium" | "high" | "critical";
              const nativeEvent = event as unknown as MouseEvent | undefined;
              if (nativeEvent?.shiftKey && onFilter) {
                onFilter({ urgency: value });
              } else {
                onDrillDown?.({ type: "urgency", value });
              }
            }}
            style={{ cursor: "pointer" }}
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.key}
                fill={URGENCY_COLOURS[entry.key] ?? "#cbd5e1"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </DashboardCard>
  );
}
