"use client";

import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";

import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";
import { URGENCY_COLOURS } from "./chart-colours";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientHealthWidgetProps {
  className?: string;
}

interface ClientRow {
  clientId: string;
  clientName: string;
  sentiment: string;
  urgency: string;
  sessionDate: string;
}

interface ClientHealthData {
  clients: ClientRow[];
}

interface ScatterPoint {
  x: number;
  y: number;
  clientName: string;
  sentiment: string;
  urgency: string;
  sessionDate: string;
}

// ---------------------------------------------------------------------------
// Axis mappings (categorical → numeric)
// ---------------------------------------------------------------------------

const SENTIMENT_MAP: Record<string, number> = {
  positive: 1,
  neutral: 2,
  negative: 3,
  mixed: 4,
};

const URGENCY_MAP: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SENTIMENT_LABELS: Record<number, string> = {
  1: "Positive",
  2: "Neutral",
  3: "Negative",
  4: "Mixed",
};

const URGENCY_LABELS: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Critical",
};

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ScatterPoint }>;
}

function HealthTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-[var(--text-primary)]">
        {point.clientName}
      </p>
      <p className="text-[var(--text-secondary)]">
        Sentiment: {point.sentiment.charAt(0).toUpperCase() + point.sentiment.slice(1)}
      </p>
      <p className="text-[var(--text-secondary)]">
        Urgency: {point.urgency.charAt(0).toUpperCase() + point.urgency.slice(1)}
      </p>
      <p className="text-[var(--text-tertiary)]">
        Last session: {new Date(point.sessionDate).toLocaleDateString("en-GB")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClientHealthWidget
// ---------------------------------------------------------------------------

export function ClientHealthWidget({ className }: ClientHealthWidgetProps) {
  const { data, isLoading, error, refetch } =
    useDashboardFetch<ClientHealthData>({ action: "client_health_grid" });

  const scatterData = useMemo<ScatterPoint[]>(() => {
    if (!data?.clients) return [];

    return data.clients
      .filter(
        (c) =>
          c.sentiment !== "unknown" &&
          c.urgency !== "unknown" &&
          SENTIMENT_MAP[c.sentiment] !== undefined &&
          URGENCY_MAP[c.urgency] !== undefined
      )
      .map((c) => ({
        x: SENTIMENT_MAP[c.sentiment],
        y: URGENCY_MAP[c.urgency],
        clientName: c.clientName,
        sentiment: c.sentiment,
        urgency: c.urgency,
        sessionDate: c.sessionDate,
      }));
  }, [data]);

  const isEmpty = scatterData.length === 0;

  return (
    <DashboardCard
      title="Client Health Grid"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="No clients with extracted sessions for the selected filters"
      className={className}
    >
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0.5, 4.5]}
            ticks={[1, 2, 3, 4]}
            tickFormatter={(v: number) => SENTIMENT_LABELS[v] ?? ""}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            label={{ value: "Sentiment", position: "insideBottom", offset: -2, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0.5, 4.5]}
            ticks={[1, 2, 3, 4]}
            tickFormatter={(v: number) => URGENCY_LABELS[v] ?? ""}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            label={{ value: "Urgency", angle: -90, position: "insideLeft", offset: 16, fontSize: 11 }}
          />
          <Tooltip
            content={<HealthTooltip />}
            cursor={{ strokeDasharray: "3 3" }}
          />
          <Scatter
            data={scatterData}
            onClick={(_point, _index, event) => {
              // Drill-down wired in Part 4
              // Access the original data point from the scatter data
              void event;
              const entry = _point as unknown as ScatterPoint;
              console.log("[ClientHealthWidget] clicked:", entry.clientName);
            }}
            style={{ cursor: "pointer" }}
          >
            {scatterData.map((point, index) => (
              <Cell
                key={`${point.clientName}-${index}`}
                fill={URGENCY_COLOURS[point.urgency] ?? "#94a3b8"}
                r={7}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </DashboardCard>
  );
}
