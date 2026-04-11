"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SentimentWidgetProps {
  className?: string;
}

interface SentimentData {
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
}

// ---------------------------------------------------------------------------
// Colour map
// ---------------------------------------------------------------------------

const SENTIMENT_COLOURS: Record<string, string> = {
  positive: "#22c55e", // green-500
  neutral: "#94a3b8",  // slate-400
  negative: "#ef4444", // red-500
  mixed: "#f59e0b",    // amber-500
};

// ---------------------------------------------------------------------------
// SentimentWidget
// ---------------------------------------------------------------------------

export function SentimentWidget({ className }: SentimentWidgetProps) {
  const { data, isLoading, error, refetch } =
    useDashboardFetch<SentimentData>({ action: "sentiment_distribution" });

  const chartData = data
    ? Object.entries(data)
        .filter(([, value]) => value > 0)
        .map(([name, value]) => ({ name, value }))
    : [];

  const isEmpty = !data || chartData.length === 0;

  return (
    <DashboardCard
      title="Sentiment Distribution"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="No sentiment data for the selected filters"
      className={className}
    >
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            onClick={(entry) => {
              // Drill-down wired in Part 4
              console.log("[SentimentWidget] clicked:", entry.name);
            }}
            style={{ cursor: "pointer" }}
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.name}
                fill={SENTIMENT_COLOURS[entry.name] ?? "#cbd5e1"}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [
              value,
              String(name).charAt(0).toUpperCase() + String(name).slice(1),
            ]}
          />
          <Legend
            formatter={(value: string) =>
              value.charAt(0).toUpperCase() + value.slice(1)
            }
          />
        </PieChart>
      </ResponsiveContainer>
    </DashboardCard>
  );
}
