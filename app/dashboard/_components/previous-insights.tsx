"use client";

import { useRef } from "react";
import { ChevronRight, TrendingUp, AlertTriangle, Trophy } from "lucide-react";

import { cn } from "@/lib/utils";
import type { InsightBatch, InsightType } from "@/lib/types/insight";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PreviousInsightsProps {
  batches: InsightBatch[];
  loadPrevious: () => void;
  isPreviousLoading: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Type → icon mapping (compact variant)
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<InsightType, typeof TrendingUp> = {
  trend: TrendingUp,
  anomaly: AlertTriangle,
  milestone: Trophy,
};

const TYPE_COLOURS: Record<InsightType, string> = {
  trend: "text-[var(--status-info)]",
  anomaly: "text-[var(--status-warning)]",
  milestone: "text-[var(--status-success)]",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// PreviousInsights
// ---------------------------------------------------------------------------

export function PreviousInsights({
  batches,
  loadPrevious,
  isPreviousLoading,
  className,
}: PreviousInsightsProps) {
  const loadedRef = useRef(false);

  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    const isOpen = (e.target as HTMLDetailsElement).open;
    if (isOpen && !loadedRef.current) {
      loadedRef.current = true;
      loadPrevious();
    }
  }

  return (
    <details
      className={cn("group rounded-lg border border-[var(--border-default)]", className)}
      onToggle={handleToggle}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        Previous Insights
      </summary>

      <div className="border-t border-[var(--border-default)] px-4 py-3">
        {/* Loading */}
        {isPreviousLoading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="h-3 w-32 animate-pulse rounded bg-[var(--surface-raised)]" />
                <div className="h-3 w-full animate-pulse rounded bg-[var(--surface-raised)]" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--surface-raised)]" />
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!isPreviousLoading && batches.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">
            No previous insights.
          </p>
        )}

        {/* Batch list */}
        {!isPreviousLoading && batches.length > 0 && (
          <div className="flex flex-col gap-4">
            {batches.map((batch) => (
              <div key={batch.batchId} className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-[var(--text-muted)]">
                  {formatDate(batch.generatedAt)}
                </p>
                <div className="flex flex-col gap-1">
                  {batch.insights.map((insight) => {
                    const Icon = TYPE_ICONS[insight.insightType];
                    return (
                      <div
                        key={insight.id}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-primary)]"
                      >
                        <Icon
                          className={cn(
                            "mt-0.5 size-3.5 shrink-0",
                            TYPE_COLOURS[insight.insightType]
                          )}
                        />
                        <span className="leading-snug">{insight.content}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
