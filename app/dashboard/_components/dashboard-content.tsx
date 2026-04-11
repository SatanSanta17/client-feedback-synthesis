"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

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
  // Widgets will consume searchParams to re-fetch on filter changes
  const searchParams = useSearchParams();
  void searchParams;

  // Drill-down state: non-null opens the panel
  const [drillDownContext, setDrillDownContext] =
    useState<DrillDownContext | null>(null);

  const handleDrillDown = useCallback((context: DrillDownContext) => {
    setDrillDownContext(context);
  }, []);

  const handleDrillDownClose = useCallback(() => {
    setDrillDownContext(null);
  }, []);

  return (
    <>
      {/* Global filter bar */}
      <FilterBar />

      {/* Responsive widget grid: 1 col mobile, 2 col md, 3 col lg */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SentimentWidget onDrillDown={handleDrillDown} />
        <UrgencyWidget onDrillDown={handleDrillDown} />
        <SessionVolumeWidget />
        <ClientHealthWidget onDrillDown={handleDrillDown} />
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
    </>
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
