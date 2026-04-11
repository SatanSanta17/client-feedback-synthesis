"use client";

import { TrendingUp, AlertTriangle, Trophy, RefreshCw, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DashboardInsight, InsightBatch, InsightType } from "@/lib/types/insight";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InsightCardsRowProps {
  latestBatch: InsightBatch | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Type → visual mapping
// ---------------------------------------------------------------------------

const INSIGHT_TYPE_CONFIG: Record<
  InsightType,
  {
    icon: typeof TrendingUp;
    label: string;
    bgClass: string;
    borderClass: string;
    iconClass: string;
    labelClass: string;
  }
> = {
  trend: {
    icon: TrendingUp,
    label: "Trend",
    bgClass: "bg-[var(--status-info-light)]",
    borderClass: "border-[var(--status-info-border)]",
    iconClass: "text-[var(--status-info)]",
    labelClass: "text-[var(--status-info-text)]",
  },
  anomaly: {
    icon: AlertTriangle,
    label: "Anomaly",
    bgClass: "bg-[var(--status-warning-light)]",
    borderClass: "border-[var(--status-warning-border)]",
    iconClass: "text-[var(--status-warning)]",
    labelClass: "text-[var(--status-warning-text)]",
  },
  milestone: {
    icon: Trophy,
    label: "Milestone",
    bgClass: "bg-[var(--status-success-light)]",
    borderClass: "border-[var(--status-success-border)]",
    iconClass: "text-[var(--status-success)]",
    labelClass: "text-[var(--status-success)]",
  },
};

// ---------------------------------------------------------------------------
// Relative timestamp
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InsightCard({ insight }: { insight: DashboardInsight }) {
  const config = INSIGHT_TYPE_CONFIG[insight.insightType];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex min-w-[260px] max-w-[340px] shrink-0 flex-col gap-2 rounded-lg border p-3",
        config.bgClass,
        config.borderClass
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("size-3.5", config.iconClass)} />
        <span className={cn("text-xs font-semibold uppercase tracking-wide", config.labelClass)}>
          {config.label}
        </span>
      </div>
      <p className="text-sm leading-snug text-[var(--text-primary)]">
        {insight.content}
      </p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex min-w-[260px] max-w-[340px] shrink-0 flex-col gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-3">
      <div className="h-3 w-16 animate-pulse rounded bg-[var(--border-default)]" />
      <div className="h-4 w-full animate-pulse rounded bg-[var(--border-default)]" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--border-default)]" />
    </div>
  );
}

function EmptyState({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-3">
      <Sparkles className="size-5 shrink-0 text-[var(--text-muted)]" />
      <p className="text-sm text-[var(--text-secondary)]">
        No insights yet.{" "}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="font-medium text-[var(--brand-primary)] hover:underline disabled:opacity-50"
        >
          {isRefreshing ? "Generating\u2026" : "Generate your first headline insights"}
        </button>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsightCardsRow
// ---------------------------------------------------------------------------

export function InsightCardsRow({
  latestBatch,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  className,
}: InsightCardsRowProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className={cn("flex gap-3 overflow-x-auto pb-1", className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn("flex items-center gap-3 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-light)] px-4 py-3", className)}>
        <p className="text-sm text-[var(--status-error)]">
          Failed to load insights.{" "}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="font-medium underline"
          >
            Retry
          </button>
        </p>
      </div>
    );
  }

  // Empty state
  if (!latestBatch || latestBatch.insights.length === 0) {
    return (
      <div className={className}>
        <EmptyState onRefresh={onRefresh} isRefreshing={isRefreshing} />
      </div>
    );
  }

  // Content
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Header row: timestamp + refresh button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">
          Generated {timeAgo(latestBatch.generatedAt)}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary-light)] disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
          {isRefreshing ? "Generating\u2026" : "Refresh Insights"}
        </button>
      </div>

      {/* Scrollable card row */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {latestBatch.insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </div>
    </div>
  );
}
