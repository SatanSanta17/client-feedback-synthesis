"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { FilterBar } from "./filter-bar";
import { SentimentWidget } from "./sentiment-widget";
import { UrgencyWidget } from "./urgency-widget";
import { SessionVolumeWidget } from "./session-volume-widget";
import { CompetitiveMentionsWidget } from "./competitive-mentions-widget";
import { ClientHealthWidget } from "./client-health-widget";
import { TopThemesWidget } from "./top-themes-widget";
import { ThemeTrendsWidget } from "./theme-trends-widget";
import { ThemeClientMatrixWidget } from "./theme-client-matrix-widget";
import { DrillDownPanel } from "./drill-down-panel";
import type { DrillDownContext } from "./drill-down-types";
import { useInsights } from "./use-insights";
import { InsightCardsRow } from "./insight-cards-row";
import { PreviousInsights } from "./previous-insights";
import { FreshnessContext } from "./freshness-context";
import { FreshnessIndicator } from "./freshness-indicator";
import { exportDashboardAsImage } from "./export-dashboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardContentProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// Inner content (reads useSearchParams — must be inside Suspense)
// ---------------------------------------------------------------------------

function DashboardInner() {
  const router = useRouter();
  // Widgets consume searchParams to re-fetch on filter changes;
  // also used by applyWidgetFilter and activeFilters derivation.
  const searchParams = useSearchParams();

  // Insights state
  const insights = useInsights();

  // Drill-down state: non-null opens the panel
  const [drillDownContext, setDrillDownContext] =
    useState<DrillDownContext | null>(null);

  const handleDrillDown = useCallback((context: DrillDownContext) => {
    setDrillDownContext(context);
  }, []);

  const handleDrillDownClose = useCallback(() => {
    setDrillDownContext(null);
  }, []);

  // Cross-widget filter: merges key-value pairs into URL search params
  const applyWidgetFilter = useCallback(
    (filters: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(filters)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // ----------- Data freshness tracking -----------
  const lastFetchedAtRef = useRef<number>(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const handleFetchComplete = useCallback(() => {
    lastFetchedAtRef.current = Date.now();
  }, []);

  // Sync ref → state every 30 seconds (avoids re-rendering all children on
  // every individual widget fetch while keeping the indicator up to date).
  useEffect(() => {
    const id = setInterval(() => {
      if (lastFetchedAtRef.current > 0) {
        setLastFetchedAt(lastFetchedAtRef.current);
      }
    }, 30_000);

    // Also do an immediate sync once ref is populated (short delay so the
    // first batch of widget fetches has time to complete).
    const initialId = setTimeout(() => {
      if (lastFetchedAtRef.current > 0) {
        setLastFetchedAt(lastFetchedAtRef.current);
      }
    }, 2_000);

    return () => {
      clearInterval(id);
      clearTimeout(initialId);
    };
  }, []);

  const freshnessValue = useMemo(
    () => ({ onFetchComplete: handleFetchComplete }),
    [handleFetchComplete]
  );

  // ----------- Screenshot export -----------
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Derive active filters from URL params for the export header
  const activeFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    const keys = ["clients", "dateFrom", "dateTo", "severity", "urgency"];
    for (const key of keys) {
      const val = searchParams.get(key);
      if (val) filters[key] = val;
    }
    return filters;
  }, [searchParams]);

  const handleExport = useCallback(async () => {
    if (!dashboardRef.current) return;
    setIsExporting(true);
    try {
      await exportDashboardAsImage(dashboardRef.current, activeFilters);
    } catch {
      // Error already logged inside exportDashboardAsImage
    } finally {
      setIsExporting(false);
    }
  }, [activeFilters]);

  return (
    <FreshnessContext.Provider value={freshnessValue}>
      <div ref={dashboardRef} className="flex flex-col gap-6">
      {/* Global filter bar */}
      <FilterBar onExport={handleExport} isExporting={isExporting} />

      {/* Data freshness */}
      <FreshnessIndicator lastFetchedAt={lastFetchedAt} className="-mt-4" />

      {/* Headline insights */}
      <InsightCardsRow
        latestBatch={insights.latestBatch}
        isLoading={insights.isLoading}
        error={insights.error}
        onRefresh={insights.refresh}
        isRefreshing={insights.isRefreshing}
      />
      <PreviousInsights
        batches={insights.previousBatches}
        loadPrevious={insights.loadPrevious}
        isPreviousLoading={insights.isPreviousLoading}
      />

      {/* Responsive widget grid: 1 col mobile, 2 col md, 3 col lg */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SentimentWidget onDrillDown={handleDrillDown} onFilter={applyWidgetFilter} />
        <UrgencyWidget onDrillDown={handleDrillDown} onFilter={applyWidgetFilter} />
        <SessionVolumeWidget />
        <ClientHealthWidget onDrillDown={handleDrillDown} onFilter={applyWidgetFilter} />
        <CompetitiveMentionsWidget onDrillDown={handleDrillDown} />
        <TopThemesWidget onDrillDown={handleDrillDown} />
        <ThemeTrendsWidget onDrillDown={handleDrillDown} />
        <ThemeClientMatrixWidget onDrillDown={handleDrillDown} />
      </div>

      {/* Drill-down panel */}
      <DrillDownPanel
        context={drillDownContext}
        onClose={handleDrillDownClose}
      />
      </div>
    </FreshnessContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// DashboardContent
// ---------------------------------------------------------------------------

export function DashboardContent({ className }: DashboardContentProps) {
  return (
    <div className={cn("flex flex-1 flex-col gap-6", className)}>
      <Suspense fallback={<div className="h-10 animate-pulse rounded-lg bg-[var(--surface-raised)]" />}>
        <DashboardInner />
      </Suspense>
    </div>
  );
}
