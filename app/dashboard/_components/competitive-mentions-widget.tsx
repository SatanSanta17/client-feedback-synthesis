"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";
import type { DrillDownContext } from "./drill-down-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompetitiveMentionsWidgetProps {
  className?: string;
  onDrillDown?: (context: DrillDownContext) => void;
}

interface Competitor {
  name: string;
  count: number;
}

interface CompetitiveData {
  competitors: Competitor[];
}

// ---------------------------------------------------------------------------
// CompetitiveMentionsWidget
// ---------------------------------------------------------------------------

export function CompetitiveMentionsWidget({
  className,
  onDrillDown,
}: CompetitiveMentionsWidgetProps) {
  const { data, isLoading, error, refetch } =
    useDashboardFetch<CompetitiveData>({
      action: "competitive_mention_frequency",
    });

  const chartData = data?.competitors ?? [];
  const isEmpty = chartData.length === 0;

  // Dynamic height: at least 160px, grow with number of competitors
  const chartHeight = Math.max(160, chartData.length * 32 + 40);

  return (
    <DashboardCard
      title="Competitive Mentions"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="No competitive mentions for the selected filters"
      className={className}
    >
      <ResponsiveContainer width="100%" height={Math.min(chartHeight, 280)}>
        <BarChart
          data={chartData}
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
            dataKey="name"
            tick={{ fontSize: 12 }}
            width={100}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(value) => [value, "Mentions"]} />
          <Bar
            dataKey="count"
            fill="#8b5cf6"
            radius={[0, 4, 4, 0]}
            onClick={(entry) => {
              onDrillDown?.({ type: "competitor", competitor: entry.name as string });
            }}
            style={{ cursor: "pointer" }}
          />
        </BarChart>
      </ResponsiveContainer>
    </DashboardCard>
  );
}
